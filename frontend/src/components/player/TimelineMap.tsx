import { Component, useEffect, useRef, useCallback, useState } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { usePlayerStore } from '../../store/playerStore';
import { useSegmentGeo } from '../../hooks/useSegmentGeo';
import mapStyleDark from '../../styles/map-style.json';
import mapStyleLight from '../../styles/map-style-light.json';
import '../../styles/timeline-map.css';

function getActiveMapStyle(): typeof mapStyleDark {
  const theme = document.documentElement.getAttribute('data-theme');
  return theme === 'light' ? mapStyleLight : mapStyleDark;
}
import type { GeoEvent, GeoRoute } from '../../types';

const ROUTE_SOURCE_PREFIX = 'route-';
const ROUTE_LAYER_PREFIX = 'route-layer-';
const PIN_SOURCE = 'pin-source';
const PIN_GLOW_CIRCLE = 'pin-glow-circles';
const PIN_GLOW_DIAMOND = 'pin-glow-diamonds';
const PIN_PULSE_CIRCLE = 'pin-pulse-circles';
const PIN_PULSE_DIAMOND = 'pin-pulse-diamonds';
const PIN_CIRCLE_LAYER = 'pin-circles';
const PIN_DIAMOND_LAYER = 'pin-diamonds';

const ALL_PIN_LAYERS = [
  PIN_DIAMOND_LAYER, PIN_CIRCLE_LAYER,
  PIN_PULSE_DIAMOND, PIN_PULSE_CIRCLE,
  PIN_GLOW_DIAMOND, PIN_GLOW_CIRCLE,
];

/** Build a GeoJSON FeatureCollection from geo events */
function eventsToGeoJSON(events: GeoEvent[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: events.map((e, i) => ({
      type: 'Feature' as const,
      properties: {
        name: e.name,
        era: e.era ?? '',
        description: e.description ?? '',
        type: e.type,
        index: i,
        isBattle: e.type === 'battle' ? 1 : 0,
      },
      geometry: {
        type: 'Point' as const,
        coordinates: [e.lng, e.lat],
      },
    })),
  };
}

function TimelineMapInner({
  onPinClick,
}: {
  onPinClick?: (locationName: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pendingMoveEndRef = useRef<(() => void) | null>(null);
  const geoEpochRef = useRef(0);
  const mapReadyRef = useRef(false);
  const [tooltipInfo, setTooltipInfo] = useState<{
    name: string;
    era: string;
    description: string;
    x: number;
    y: number;
  } | null>(null);

  const currentSegmentId = usePlayerStore((s) => s.currentSegmentId);
  const { geo } = useSegmentGeo(currentSegmentId);

  // ── Initialize map ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const container = containerRef.current;
    const preventBrowserZoom = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    container.addEventListener('wheel', preventBrowserZoom, { passive: false });

    const stadiaKey = import.meta.env.VITE_STADIA_API_KEY as string | undefined;
    const style = JSON.parse(JSON.stringify(getActiveMapStyle())) as maplibregl.StyleSpecification;
    if (stadiaKey) {
      const src = (style.sources as Record<string, { url?: string }>)['openmaptiles'];
      if (src?.url) src.url = `${src.url}?api_key=${stadiaKey}`;
      if (style.glyphs) style.glyphs = `${style.glyphs}?api_key=${stadiaKey}`;
    }

    const map = new maplibregl.Map({
      container,
      style,
      center: [30, 35],
      zoom: 3,
      attributionControl: false,
      fadeDuration: 200,
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'bottom-right',
    );

    map.on('load', () => { mapReadyRef.current = true; });
    mapRef.current = map;

    return () => {
      container.removeEventListener('wheel', preventBrowserZoom);
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
    };
  }, []);

  // ── Swap map style when data-theme changes ──────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const observer = new MutationObserver(() => {
      const newStyle = JSON.parse(JSON.stringify(getActiveMapStyle())) as maplibregl.StyleSpecification;
      const stadiaKey = import.meta.env.VITE_STADIA_API_KEY as string | undefined;
      if (stadiaKey) {
        const src = (newStyle.sources as Record<string, { url?: string }>)['openmaptiles'];
        if (src?.url) src.url = `${src.url}?api_key=${stadiaKey}`;
        if (newStyle.glyphs) newStyle.glyphs = `${newStyle.glyphs}?api_key=${stadiaKey}`;
      }
      map.setStyle(newStyle);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  // ── Setup interaction handlers (once) ────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const pinLayers = [PIN_CIRCLE_LAYER, PIN_DIAMOND_LAYER];

    const setGlowIntensity = (intense: boolean) => {
      const opacity = intense ? 0.35 : 0.15;
      const radius = intense ? 26 : 20;
      for (const id of [PIN_GLOW_CIRCLE, PIN_GLOW_DIAMOND]) {
        try {
          map.setPaintProperty(id, 'circle-opacity', opacity);
          map.setPaintProperty(id, 'circle-radius', radius);
        } catch { /* layer may not exist yet */ }
      }
    };

    const onMouseEnter = (e: maplibregl.MapMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer';
      setGlowIntensity(true);
      const f = map.queryRenderedFeatures(e.point, { layers: pinLayers })[0];
      if (f) {
        const props = f.properties as Record<string, string>;
        setTooltipInfo({
          name: props.name ?? '',
          era: props.era ?? '',
          description: props.description ?? '',
          x: e.point.x,
          y: e.point.y,
        });
      }
    };

    const onMouseLeave = () => {
      map.getCanvas().style.cursor = '';
      setGlowIntensity(false);
      setTooltipInfo(null);
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const f = map.queryRenderedFeatures(e.point, { layers: pinLayers })[0];
      if (f) {
        const props = f.properties as Record<string, string>;
        setTooltipInfo({
          name: props.name ?? '',
          era: props.era ?? '',
          description: props.description ?? '',
          x: e.point.x,
          y: e.point.y,
        });
      } else {
        setTooltipInfo(null);
      }
    };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const f = map.queryRenderedFeatures(e.point, { layers: pinLayers })[0];
      if (f) {
        const name = (f.properties as Record<string, string>).name;
        if (name) onPinClick?.(name);
      }
    };

    const setupListeners = () => {
      for (const layer of pinLayers) {
        map.on('mouseenter', layer, onMouseEnter);
        map.on('mouseleave', layer, onMouseLeave);
        map.on('mousemove', layer, onMouseMove);
        map.on('click', layer, onClick);
      }
    };

    // Listeners need layers to exist; set up after first geo render
    // We use a one-time 'sourcedata' listener as fallback
    if (map.getLayer(PIN_CIRCLE_LAYER)) {
      setupListeners();
    } else {
      const onSource = () => {
        if (map.getLayer(PIN_CIRCLE_LAYER)) {
          map.off('sourcedata', onSource);
          setupListeners();
        }
      };
      map.on('sourcedata', onSource);
    }

    return () => {
      for (const layer of pinLayers) {
        try { map.off('mouseenter', layer, onMouseEnter); } catch { /* ok */ }
        try { map.off('mouseleave', layer, onMouseLeave); } catch { /* ok */ }
        try { map.off('mousemove', layer, onMouseMove); } catch { /* ok */ }
        try { map.off('click', layer, onClick); } catch { /* ok */ }
      }
    };
  }, [onPinClick]);

  const pulseRafRef = useRef<number>(0);

  const clearPinLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (pulseRafRef.current) cancelAnimationFrame(pulseRafRef.current);
    pulseRafRef.current = 0;
    for (const id of ALL_PIN_LAYERS) {
      try { map.removeLayer(id); } catch { /* ok */ }
    }
    try { map.removeSource(PIN_SOURCE); } catch { /* ok */ }
  }, []);

  const clearRoutes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = map.getStyle();
    if (!style?.layers) return;
    for (const layer of style.layers) {
      if (layer.id.startsWith(ROUTE_LAYER_PREFIX)) {
        try { map.removeLayer(layer.id); } catch { /* ok */ }
      }
    }
    for (const sourceId of Object.keys(style.sources ?? {})) {
      if (sourceId.startsWith(ROUTE_SOURCE_PREFIX)) {
        try { map.removeSource(sourceId); } catch { /* ok */ }
      }
    }
  }, []);

  const addPins = useCallback((events: GeoEvent[]) => {
    const map = mapRef.current;
    if (!map) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    map.addSource(PIN_SOURCE, {
      type: 'geojson',
      data: eventsToGeoJSON(events),
    });

    // ── Glow layers (large blurred circles behind the pins) ──
    map.addLayer({
      id: PIN_GLOW_CIRCLE,
      type: 'circle',
      source: PIN_SOURCE,
      filter: ['==', ['get', 'isBattle'], 0],
      paint: {
        'circle-radius': 20,
        'circle-color': '#c4956a',
        'circle-opacity': 0.15,
        'circle-blur': 1,
      },
    });

    map.addLayer({
      id: PIN_GLOW_DIAMOND,
      type: 'circle',
      source: PIN_SOURCE,
      filter: ['==', ['get', 'isBattle'], 1],
      paint: {
        'circle-radius': 20,
        'circle-color': '#c0392b',
        'circle-opacity': 0.15,
        'circle-blur': 1,
      },
    });

    // ── Pulse layers (expanding rings) ──
    if (!reducedMotion) {
      map.addLayer({
        id: PIN_PULSE_CIRCLE,
        type: 'circle',
        source: PIN_SOURCE,
        filter: ['==', ['get', 'isBattle'], 0],
        paint: {
          'circle-radius': 8,
          'circle-color': 'transparent',
          'circle-stroke-color': '#c4956a',
          'circle-stroke-width': 1,
          'circle-opacity': 0.6,
          'circle-stroke-opacity': 0.6,
        },
      });

      map.addLayer({
        id: PIN_PULSE_DIAMOND,
        type: 'circle',
        source: PIN_SOURCE,
        filter: ['==', ['get', 'isBattle'], 1],
        paint: {
          'circle-radius': 8,
          'circle-color': 'transparent',
          'circle-stroke-color': '#c0392b',
          'circle-stroke-width': 1,
          'circle-opacity': 0.6,
          'circle-stroke-opacity': 0.6,
        },
      });

      // Animate pulse rings
      const PULSE_DURATION = 2000;
      const startTime = performance.now();
      const animatePulse = () => {
        if (!mapRef.current) return;
        const elapsed = (performance.now() - startTime) % PULSE_DURATION;
        const t = elapsed / PULSE_DURATION;
        const radius = 8 + t * 22;          // 8 → 30
        const opacity = 0.6 * (1 - t);      // 0.6 → 0

        for (const id of [PIN_PULSE_CIRCLE, PIN_PULSE_DIAMOND]) {
          try {
            map.setPaintProperty(id, 'circle-radius', radius);
            map.setPaintProperty(id, 'circle-stroke-opacity', opacity);
          } catch { /* layer removed */ }
        }
        pulseRafRef.current = requestAnimationFrame(animatePulse);
      };
      pulseRafRef.current = requestAnimationFrame(animatePulse);
    }

    // ── Main pin layers (solid circles on top) ──
    map.addLayer({
      id: PIN_CIRCLE_LAYER,
      type: 'circle',
      source: PIN_SOURCE,
      filter: ['==', ['get', 'isBattle'], 0],
      paint: {
        'circle-radius': 7,
        'circle-color': '#c4956a',
        'circle-stroke-color': 'rgba(255,255,255,0.3)',
        'circle-stroke-width': 2,
      },
    });

    map.addLayer({
      id: PIN_DIAMOND_LAYER,
      type: 'circle',
      source: PIN_SOURCE,
      filter: ['==', ['get', 'isBattle'], 1],
      paint: {
        'circle-radius': 7,
        'circle-color': '#c0392b',
        'circle-stroke-color': 'rgba(255,255,255,0.3)',
        'circle-stroke-width': 2,
      },
    });
  }, []);

  const addRoute = useCallback((route: GeoRoute, index: number) => {
    const map = mapRef.current;
    if (!map) return;

    const epoch = geoEpochRef.current;
    const sourceId = `${ROUTE_SOURCE_PREFIX}${epoch}-${index}`;
    const layerId = `${ROUTE_LAYER_PREFIX}${epoch}-${index}`;
    const coordinates = route.points.map(([lat, lng]) => [lng, lat]);

    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      },
    });

    const colorMap: Record<string, string> = {
      trade: '#d4a574',
      military: '#c0392b',
      migration: '#1E5E5E',
    };

    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': colorMap[route.style] ?? '#d4a574',
        'line-width': 2.5,
        'line-opacity': 0.8,
        'line-dasharray': [3, 2],
      },
    });
  }, []);

  // ── React to geo changes ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const proceed = () => {
      if (pendingMoveEndRef.current) {
        map.off('moveend', pendingMoveEndRef.current);
        pendingMoveEndRef.current = null;
      }

      clearPinLayers();
      clearRoutes();
      setTooltipInfo(null);
      geoEpochRef.current += 1;

      if (!geo) return;

      const capturedEpoch = geoEpochRef.current;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const onMoveEnd = () => {
        map.off('moveend', onMoveEnd);
        pendingMoveEndRef.current = null;

        if (geoEpochRef.current !== capturedEpoch) return;

        addPins(geo.events);

        for (let i = 0; i < geo.routes.length; i++) {
          addRoute(geo.routes[i], i);
        }
      };

      pendingMoveEndRef.current = onMoveEnd;
      map.on('moveend', onMoveEnd);

      map.flyTo({
        center: [geo.center[1], geo.center[0]],
        zoom: geo.zoom,
        duration: reducedMotion ? 0 : 2000,
        essential: true,
      });
    };

    if (mapReadyRef.current) {
      proceed();
    } else {
      map.once('load', proceed);
    }
  }, [geo, clearPinLayers, clearRoutes, addPins, addRoute]);

  return (
    <div className="relative w-full h-full timeline-map">
      <div
        ref={containerRef}
        className="w-full h-full"
        role="img"
        aria-label="Historical timeline map showing locations and routes for the current segment"
      />

      {/* React-rendered tooltip (follows cursor, no DOM inside marker) */}
      {tooltipInfo && (
        <div
          className="timeline-map-tooltip timeline-map-tooltip--visible"
          style={{
            left: tooltipInfo.x,
            top: tooltipInfo.y,
          }}
        >
          <span className="timeline-map-tooltip-name">{tooltipInfo.name}</span>
          {tooltipInfo.era && (
            <span className="timeline-map-tooltip-era">{tooltipInfo.era}</span>
          )}
          {tooltipInfo.description && (
            <div className="timeline-map-tooltip-desc">{tooltipInfo.description}</div>
          )}
        </div>
      )}

      {/* Vignette overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 50%, color-mix(in srgb, var(--player-bg) 60%, transparent) 100%)',
        }}
      />
    </div>
  );
}

/** Error boundary so a MapLibre crash doesn't take down the entire player */
class TimelineMapBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[TimelineMap] crashed:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{ background: 'var(--player-bg)', color: 'var(--player-text-dim)', fontFamily: 'var(--font-sans)', fontSize: 12 }}
        >
          Map unavailable
        </div>
      );
    }
    return this.props.children;
  }
}

export function TimelineMap(props: { onPinClick?: (locationName: string) => void }) {
  return (
    <TimelineMapBoundary>
      <TimelineMapInner {...props} />
    </TimelineMapBoundary>
  );
}
