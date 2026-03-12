import { useEffect, useRef, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { usePlayerStore } from '../../store/playerStore';
import { useSegmentGeo } from '../../hooks/useSegmentGeo';
import mapStyle from '../../styles/map-style.json';
import type { GeoEvent, GeoRoute } from '../../types';

const ROUTE_SOURCE_PREFIX = 'route-';
const ROUTE_LAYER_PREFIX = 'route-layer-';
const PIN_ANIMATION_DELAY = 200;

/** Escape HTML entities to prevent XSS from LLM-generated geo data */
function escapeHtml(str: string): string {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

export function TimelineMap({
  onPinClick,
}: {
  onPinClick?: (locationName: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const pinTimeoutIds = useRef<ReturnType<typeof setTimeout>[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const pendingMoveEndRef = useRef<(() => void) | null>(null);
  const geoEpochRef = useRef(0);
  const mapReadyRef = useRef(false);

  const currentSegmentId = usePlayerStore((s) => s.currentSegmentId);
  const { geo } = useSegmentGeo(currentSegmentId);

  // ── Initialize map ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    // Prevent ctrl+scroll from triggering browser zoom on the map
    const container = containerRef.current;
    const preventBrowserZoom = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    container.addEventListener('wheel', preventBrowserZoom, { passive: false });

    const map = new maplibregl.Map({
      container,
      style: mapStyle as maplibregl.StyleSpecification,
      center: [30, 35],
      zoom: 3,
      attributionControl: false,
      fadeDuration: 0,
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

  const clearMarkers = useCallback(() => {
    for (const id of pinTimeoutIds.current) clearTimeout(id);
    pinTimeoutIds.current = [];
    for (const m of markersRef.current) m.remove();
    markersRef.current = [];
    popupRef.current?.remove();
    popupRef.current = null;
  }, []);

  const clearRoutes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = map.getStyle();
    if (!style?.layers) return;
    for (const layer of style.layers) {
      if (layer.id.startsWith(ROUTE_LAYER_PREFIX)) {
        try { map.removeLayer(layer.id); } catch { /* already removed */ }
      }
    }
    for (const sourceId of Object.keys(style.sources ?? {})) {
      if (sourceId.startsWith(ROUTE_SOURCE_PREFIX)) {
        try { map.removeSource(sourceId); } catch { /* already removed */ }
      }
    }
  }, []);

  // ── Show popup at pin location ────────────────────────────
  const showPopup = useCallback((event: GeoEvent) => {
    const map = mapRef.current;
    if (!map) return;

    popupRef.current?.remove();

    const era = event.era ? `<span style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#8A7A62;margin-left:6px">${escapeHtml(event.era)}</span>` : '';
    const desc = event.description ? `<div style="font-size:10px;color:rgba(232,221,208,0.6);margin-top:2px">${escapeHtml(event.description)}</div>` : '';

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: true,
      offset: 14,
      className: 'timeline-map-popup',
    })
      .setLngLat([event.lng, event.lat])
      .setHTML(`
        <div style="font-family:var(--font-serif);font-size:14px;color:#c4956a;letter-spacing:0.04em">
          ${escapeHtml(event.name)}${era}
        </div>
        ${desc}
      `)
      .addTo(map);

    popupRef.current = popup;
  }, []);

  // ── Create a pin DOM element ──────────────────────────────
  const createPinElement = useCallback(
    (event: GeoEvent, index: number) => {
      const el = document.createElement('div');
      el.className = 'timeline-map-pin';

      const isBattle = event.type === 'battle';
      const size = isBattle ? 18 : 16;
      const color = isBattle ? '#c0392b' : '#c4956a';

      el.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        border-radius: ${isBattle ? '3px' : '50%'};
        background: ${color};
        border: 2px solid rgba(255,255,255,0.3);
        box-shadow: 0 0 16px ${color}, 0 0 32px ${color}80;
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        transform: ${isBattle ? 'rotate(45deg)' : ''} scale(1);
        position: relative;
        z-index: 10;
      `;

      const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (prefersReduced) {
        el.style.opacity = '1';
      } else {
        el.style.opacity = '0';
        const tid = setTimeout(() => {
          el.style.transition = 'opacity 0.4s ease, transform 0.4s ease, box-shadow 0.2s ease';
          el.style.opacity = '1';
        }, index * PIN_ANIMATION_DELAY);
        pinTimeoutIds.current.push(tid);

        const pulse = document.createElement('div');
        pulse.style.cssText = `
          position: absolute;
          top: 50%;
          left: 50%;
          width: ${size * 3}px;
          height: ${size * 3}px;
          border-radius: 50%;
          border: 1px solid ${color}60;
          transform: translate(-50%, -50%);
          animation: pin-pulse 2s ease-out infinite;
          animation-delay: ${index * PIN_ANIMATION_DELAY + 400}ms;
          pointer-events: none;
        `;
        el.appendChild(pulse);
      }

      // Invisible hit area so hover doesn't flicker from scale transform
      const hitArea = document.createElement('div');
      hitArea.style.cssText = `
        position: absolute;
        top: 50%; left: 50%;
        width: ${size * 3}px; height: ${size * 3}px;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        pointer-events: auto;
      `;
      el.appendChild(hitArea);

      hitArea.addEventListener('mouseenter', () => {
        showPopup(event);
        el.style.transform = `${isBattle ? 'rotate(45deg) ' : ''}scale(1.4)`;
        el.style.boxShadow = `0 0 24px ${color}, 0 0 48px ${color}aa`;
      });

      hitArea.addEventListener('mouseleave', () => {
        popupRef.current?.remove();
        popupRef.current = null;
        el.style.transform = `${isBattle ? 'rotate(45deg) ' : ''}scale(1)`;
        el.style.boxShadow = `0 0 16px ${color}, 0 0 32px ${color}80`;
      });

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onPinClick?.(event.name);
      });

      return el;
    },
    [onPinClick, showPopup],
  );

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

      clearMarkers();
      clearRoutes();
      geoEpochRef.current += 1;

      if (!geo) return;

      const capturedEpoch = geoEpochRef.current;
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const onMoveEnd = () => {
        map.off('moveend', onMoveEnd);
        pendingMoveEndRef.current = null;

        // Guard against stale callback from a previous segment's fly-to
        if (geoEpochRef.current !== capturedEpoch) return;

        for (let i = 0; i < geo.events.length; i++) {
          const event = geo.events[i];
          const el = createPinElement(event, reducedMotion ? 0 : i);
          const marker = new maplibregl.Marker({ element: el })
            .setLngLat([event.lng, event.lat])
            .addTo(map);
          markersRef.current.push(marker);
        }

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

    // Defer until map style is loaded (addSource/addLayer require it)
    if (mapReadyRef.current) {
      proceed();
    } else {
      map.once('load', proceed);
    }
  }, [geo, clearMarkers, clearRoutes, createPinElement, addRoute]);

  return (
    <div className="relative w-full h-full">
      <style>{`
        @keyframes pin-pulse {
          0%   { transform: translate(-50%, -50%) scale(0.5); opacity: 0.6; }
          100% { transform: translate(-50%, -50%) scale(1.5); opacity: 0; }
        }
        .maplibregl-ctrl-group {
          background: rgba(26,21,16,0.8) !important;
          border: 1px solid rgba(139,94,26,0.2) !important;
          border-radius: 6px !important;
        }
        .maplibregl-ctrl-group button {
          border: none !important;
        }
        .maplibregl-ctrl-group button + button {
          border-top: 1px solid rgba(139,94,26,0.15) !important;
        }
        .maplibregl-ctrl-group button span {
          filter: invert(0.7) sepia(0.3) !important;
        }
        .timeline-map-popup .maplibregl-popup-content {
          background: rgba(13,11,9,0.92) !important;
          border: 1px solid rgba(196,149,106,0.3) !important;
          border-radius: 8px !important;
          padding: 8px 14px !important;
          box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
        }
        .timeline-map-popup .maplibregl-popup-tip {
          border-top-color: rgba(13,11,9,0.92) !important;
        }
      `}</style>

      <div
        ref={containerRef}
        className="w-full h-full"
        role="img"
        aria-label="Historical timeline map showing locations and routes for the current segment"
      />

      {/* Vignette overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, transparent 50%, rgba(13,11,9,0.6) 100%)',
        }}
      />
    </div>
  );
}
