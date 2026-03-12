import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { usePlayerStore } from '../../store/playerStore';
import { useSegmentGeo } from '../../hooks/useSegmentGeo';
import mapStyle from '../../styles/map-style.json';
import type { GeoEvent, GeoRoute } from '../../types';

const ROUTE_SOURCE_PREFIX = 'route-';
const ROUTE_LAYER_PREFIX = 'route-layer-';
const PIN_ANIMATION_DELAY = 150; // ms between pin appearances

/**
 * TimelineMap — Animated geographic map synced to documentary narration.
 * Renders MapLibre GL canvas with animated pins, progressive route drawing,
 * and fly-to transitions between segments.
 */
export function TimelineMap({
  onPinClick,
}: {
  onPinClick?: (locationName: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [hoveredPin, setHoveredPin] = useState<string | null>(null);

  const currentSegmentId = usePlayerStore((s) => s.currentSegmentId);
  const { geo } = useSegmentGeo(currentSegmentId);

  // ── Initialize map ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
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

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Clear markers ─────────────────────────────────────────
  const clearMarkers = useCallback(() => {
    for (const m of markersRef.current) {
      m.remove();
    }
    markersRef.current = [];
  }, []);

  // ── Clear route layers ────────────────────────────────────
  const clearRoutes = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = map.getStyle();
    if (!style?.layers) return;
    for (const layer of style.layers) {
      if (layer.id.startsWith(ROUTE_LAYER_PREFIX)) {
        map.removeLayer(layer.id);
      }
    }
    for (const sourceId of Object.keys(style.sources ?? {})) {
      if (sourceId.startsWith(ROUTE_SOURCE_PREFIX)) {
        map.removeSource(sourceId);
      }
    }
  }, []);

  // ── Create a pin DOM element ──────────────────────────────
  const createPinElement = useCallback(
    (event: GeoEvent, index: number) => {
      const el = document.createElement('div');
      el.className = 'timeline-map-pin';

      const isCity = event.type === 'city';
      const isBattle = event.type === 'battle';
      const size = isCity ? 12 : isBattle ? 14 : 10;
      const color = isBattle ? '#c0392b' : 'var(--glow-primary)';

      el.style.cssText = `
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${color};
        box-shadow: 0 0 12px ${color}, 0 0 24px rgba(196,149,106,0.3);
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
        opacity: 0;
        transform: scale(0);
        animation: pin-appear 0.4s ease forwards;
        animation-delay: ${index * PIN_ANIMATION_DELAY}ms;
      `;

      if (isBattle) {
        // Diamond shape for battles
        el.style.borderRadius = '2px';
        el.style.transform = 'rotate(45deg) scale(0)';
      }

      el.addEventListener('mouseenter', () => {
        setHoveredPin(event.name);
        el.style.transform = isBattle
          ? 'rotate(45deg) scale(1.5)'
          : 'scale(1.5)';
        el.style.boxShadow = `0 0 20px ${color}, 0 0 40px rgba(196,149,106,0.5)`;
      });

      el.addEventListener('mouseleave', () => {
        setHoveredPin(null);
        el.style.transform = isBattle ? 'rotate(45deg) scale(1)' : 'scale(1)';
        el.style.boxShadow = `0 0 12px ${color}, 0 0 24px rgba(196,149,106,0.3)`;
      });

      el.addEventListener('click', () => {
        onPinClick?.(event.name);
      });

      return el;
    },
    [onPinClick],
  );

  // ── Add route to map ──────────────────────────────────────
  const addRoute = useCallback((route: GeoRoute, index: number) => {
    const map = mapRef.current;
    if (!map) return;

    const sourceId = `${ROUTE_SOURCE_PREFIX}${index}`;
    const layerId = `${ROUTE_LAYER_PREFIX}${index}`;

    const coordinates = route.points.map(([lat, lng]) => [lng, lat]);

    map.addSource(sourceId, {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates,
        },
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
        'line-width': 2,
        'line-opacity': 0.7,
        'line-dasharray': [2, 2],
      },
    });
  }, []);

  // ── React to geo changes ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    clearMarkers();
    clearRoutes();

    if (!geo) return;

    // Fly to new center
    map.flyTo({
      center: [geo.center[1], geo.center[0]],
      zoom: geo.zoom,
      duration: 2000,
      essential: true,
    });

    // Add pins with staggered animation
    for (let i = 0; i < geo.events.length; i++) {
      const event = geo.events[i];
      const el = createPinElement(event, i);
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([event.lng, event.lat])
        .addTo(map);
      markersRef.current.push(marker);
    }

    // Add routes after map has settled
    const onMoveEnd = () => {
      for (let i = 0; i < geo.routes.length; i++) {
        addRoute(geo.routes[i], i);
      }
      map.off('moveend', onMoveEnd);
    };
    map.on('moveend', onMoveEnd);
  }, [geo, clearMarkers, clearRoutes, createPinElement, addRoute]);

  return (
    <div className="relative w-full h-full">
      {/* Pin appear animation */}
      <style>{`
        @keyframes pin-appear {
          from { opacity: 0; transform: scale(0); }
          to   { opacity: 1; transform: scale(1); }
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
      `}</style>

      <div ref={containerRef} className="w-full h-full" />

      {/* Tooltip for hovered pin */}
      <AnimatePresence>
        {hoveredPin && (
          <motion.div
            key={hoveredPin}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none z-20"
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: 16,
              color: 'var(--glow-primary)',
              textShadow: '0 2px 12px rgba(0,0,0,0.8)',
              letterSpacing: '0.05em',
            }}
          >
            {hoveredPin}
            {geo?.events.find((e) => e.name === hoveredPin)?.era && (
              <span
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 10,
                  letterSpacing: '0.15em',
                  color: 'var(--muted)',
                  marginLeft: 8,
                  textTransform: 'uppercase',
                }}
              >
                {geo.events.find((e) => e.name === hoveredPin)?.era}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Vignette overlay to blend map edges into player background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 50%, rgba(13,11,9,0.6) 100%)',
        }}
      />
    </div>
  );
}
