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
const PIN_ANIMATION_DELAY = 200; // ms between pin appearances

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
  const pendingMoveEndRef = useRef<(() => void) | null>(null);
  const [hoveredPin, setHoveredPin] = useState<GeoEvent | null>(null);

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

      const isBattle = event.type === 'battle';
      const size = isBattle ? 18 : 16;
      const color = isBattle ? '#c0392b' : '#c4956a';

      // Outer glow ring
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

      // Animate in with delay
      el.style.opacity = '0';
      setTimeout(() => {
        el.style.transition = 'opacity 0.4s ease, transform 0.4s ease, box-shadow 0.2s ease';
        el.style.opacity = '1';
      }, index * PIN_ANIMATION_DELAY);

      // Add a pulsing ring behind the pin
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

      el.addEventListener('mouseenter', () => {
        setHoveredPin(event);
        el.style.transform = `${isBattle ? 'rotate(45deg) ' : ''}scale(1.6)`;
        el.style.boxShadow = `0 0 24px ${color}, 0 0 48px ${color}aa`;
      });

      el.addEventListener('mouseleave', () => {
        setHoveredPin(null);
        el.style.transform = `${isBattle ? 'rotate(45deg) ' : ''}scale(1)`;
        el.style.boxShadow = `0 0 16px ${color}, 0 0 32px ${color}80`;
      });

      el.addEventListener('click', (e) => {
        e.stopPropagation();
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

    // Cancel any pending moveend listener from a previous fly-to
    if (pendingMoveEndRef.current) {
      map.off('moveend', pendingMoveEndRef.current);
      pendingMoveEndRef.current = null;
    }

    // Clear everything immediately
    clearMarkers();
    clearRoutes();

    if (!geo) return;

    // Fly to new center — pins and routes appear only after landing
    const onMoveEnd = () => {
      map.off('moveend', onMoveEnd);
      pendingMoveEndRef.current = null;

      // Add pins with staggered animation
      for (let i = 0; i < geo.events.length; i++) {
        const event = geo.events[i];
        const el = createPinElement(event, i);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([event.lng, event.lat])
          .addTo(map);
        markersRef.current.push(marker);
      }

      // Add routes
      for (let i = 0; i < geo.routes.length; i++) {
        addRoute(geo.routes[i], i);
      }
    };

    pendingMoveEndRef.current = onMoveEnd;
    map.on('moveend', onMoveEnd);

    map.flyTo({
      center: [geo.center[1], geo.center[0]],
      zoom: geo.zoom,
      duration: 2000,
      essential: true,
    });
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
      `}</style>

      <div ref={containerRef} className="w-full h-full" />

      {/* Tooltip for hovered pin */}
      <AnimatePresence>
        {hoveredPin && (
          <motion.div
            key={hoveredPin.name}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 pointer-events-none z-20"
            style={{
              background: 'rgba(13,11,9,0.85)',
              border: '1px solid rgba(196,149,106,0.3)',
              borderRadius: 8,
              padding: '8px 16px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-serif)',
                fontWeight: 400,
                fontSize: 16,
                color: 'var(--glow-primary)',
                letterSpacing: '0.05em',
              }}
            >
              {hoveredPin.name}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                letterSpacing: '0.15em',
                color: 'var(--muted)',
                textTransform: 'uppercase',
              }}
            >
              {[hoveredPin.era, hoveredPin.description].filter(Boolean).join(' — ')}
            </span>
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
