import { useEffect, useCallback, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useResearchStore } from '../store/researchStore';
import { TimelineMap } from '../components/player/TimelineMap';
import type { MapViewMode, SegmentGeo, Segment } from '../types';

// ── Mock data: 3 segments in different regions ──────────────
const MOCK_SEGMENTS: { segment: Segment; geo: SegmentGeo }[] = [
  {
    segment: {
      id: 'seg-1',
      title: 'The Fall of Constantinople',
      status: 'ready',
      imageUrls: [],
      script: 'Constantinople fell to the Ottoman Turks in 1453...',
      mood: 'dramatic',
      sources: [],
      graphEdges: [],
    },
    geo: {
      segmentId: 'seg-1',
      center: [41.0, 29.0],
      zoom: 5,
      events: [
        { name: 'Constantinople', lat: 41.0082, lng: 28.9784, type: 'city', era: '1453', description: 'Capital of the Byzantine Empire' },
        { name: 'Rome', lat: 41.9028, lng: 12.4964, type: 'city', era: '476 AD', description: 'Heart of the Roman Empire' },
        { name: 'Athens', lat: 37.9838, lng: 23.7275, type: 'city', era: '5th c. BC', description: 'Birthplace of democracy' },
        { name: 'Alexandria', lat: 31.2001, lng: 29.9187, type: 'city', era: '331 BC', description: 'Founded by Alexander the Great' },
        { name: 'Battle of Manzikert', lat: 39.1458, lng: 43.0237, type: 'battle', era: '1071', description: 'Decisive Seljuk victory' },
      ],
      routes: [
        {
          name: 'Via Egnatia',
          points: [[41.0, 28.97], [40.63, 22.94], [41.32, 19.82], [40.85, 17.15]],
          style: 'trade',
        },
        {
          name: 'Crusader Route',
          points: [[48.85, 2.35], [45.43, 12.33], [41.0, 28.97], [31.77, 35.23]],
          style: 'military',
        },
      ],
    },
  },
  {
    segment: {
      id: 'seg-2',
      title: 'The Silk Road',
      status: 'ready',
      imageUrls: [],
      script: 'The Silk Road connected China to the Mediterranean...',
      mood: 'epic',
      sources: [],
      graphEdges: [],
    },
    geo: {
      segmentId: 'seg-2',
      center: [38.0, 65.0],
      zoom: 3,
      events: [
        { name: "Xi'an", lat: 34.2658, lng: 108.9541, type: 'city', era: '200 BC', description: 'Eastern terminus of the Silk Road' },
        { name: 'Samarkand', lat: 39.6542, lng: 66.9597, type: 'city', era: '329 BC', description: 'Jewel of the Silk Road' },
        { name: 'Baghdad', lat: 33.3152, lng: 44.3661, type: 'city', era: '762 AD', description: 'Abbasid capital and trade hub' },
        { name: 'Kashgar', lat: 39.4704, lng: 75.9894, type: 'city', era: '200 BC', description: 'Gateway to the Tarim Basin' },
      ],
      routes: [
        {
          name: 'Silk Road (Northern)',
          points: [[34.26, 108.95], [36.06, 103.83], [39.47, 75.99], [39.65, 66.96], [33.31, 44.37], [41.01, 28.98]],
          style: 'trade',
        },
      ],
    },
  },
  {
    segment: {
      id: 'seg-3',
      title: 'The Age of Exploration',
      status: 'ready',
      imageUrls: [],
      script: 'European explorers set sail across the Atlantic...',
      mood: 'adventurous',
      sources: [],
      graphEdges: [],
    },
    geo: {
      segmentId: 'seg-3',
      center: [20.0, -30.0],
      zoom: 2,
      events: [
        { name: 'Lisbon', lat: 38.7223, lng: -9.1393, type: 'city', era: '1498', description: 'Vasco da Gama sailed from here' },
        { name: 'Seville', lat: 37.3891, lng: -5.9845, type: 'city', era: '1492', description: "Columbus's port of departure" },
        { name: 'Tenochtitlan', lat: 19.4326, lng: -99.1332, type: 'city', era: '1521', description: 'Aztec capital conquered by Cortes' },
        { name: 'Battle of Diu', lat: 20.7141, lng: 70.9871, type: 'battle', era: '1509', description: 'Portuguese naval dominance' },
      ],
      routes: [
        {
          name: "Columbus's First Voyage",
          points: [[37.39, -5.98], [28.1, -15.4], [21.47, -71.54]],
          style: 'migration',
        },
        {
          name: "Da Gama's Route",
          points: [[38.72, -9.14], [14.69, -17.44], [-33.92, 18.42], [-4.04, 39.67], [8.52, 76.94]],
          style: 'trade',
        },
      ],
    },
  },
];

/**
 * Test page for the TimelineMap component.
 * Visit /test-map to see the map with mock historical data.
 */
export function TestMapPage() {
  const setSegmentGeo = usePlayerStore((s) => s.setSegmentGeo);
  const open = usePlayerStore((s) => s.open);
  const currentSegmentId = usePlayerStore((s) => s.currentSegmentId);
  const setSegment = useResearchStore((s) => s.setSegment);
  const mapViewMode = usePlayerStore((s) => s.mapViewMode);
  const setMapViewMode = usePlayerStore((s) => s.setMapViewMode);
  const [lastPinClicked, setLastPinClicked] = useState<string | null>(null);

  // Seed all mock data on mount
  useEffect(() => {
    for (const { segment, geo } of MOCK_SEGMENTS) {
      setSegment(segment.id, segment);
      setSegmentGeo(segment.id, geo);
    }
    open(MOCK_SEGMENTS[0].segment.id);
  }, [setSegment, setSegmentGeo, open]);

  // Current segment index
  const currentIndex = MOCK_SEGMENTS.findIndex((s) => s.segment.id === currentSegmentId);
  const currentTitle = currentIndex >= 0 ? MOCK_SEGMENTS[currentIndex].segment.title : '';

  // Navigate between segments
  const goToSegment = useCallback(
    (index: number) => {
      if (index >= 0 && index < MOCK_SEGMENTS.length) {
        open(MOCK_SEGMENTS[index].segment.id);
      }
    },
    [open],
  );

  // Cycle map mode
  const cycleMapMode = useCallback(() => {
    const modes: MapViewMode[] = ['ken-burns', 'split', 'map'];
    const idx = modes.indexOf(mapViewMode);
    setMapViewMode(modes[(idx + 1) % modes.length]);
  }, [mapViewMode, setMapViewMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'm' || e.key === 'M') {
        cycleMapMode();
      } else if (e.key === 'ArrowLeft') {
        goToSegment(currentIndex - 1);
      } else if (e.key === 'ArrowRight') {
        goToSegment(currentIndex + 1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cycleMapMode, goToSegment, currentIndex]);

  // Clear pin clicked notification after 3s
  useEffect(() => {
    if (!lastPinClicked) return;
    const t = setTimeout(() => setLastPinClicked(null), 3000);
    return () => clearTimeout(t);
  }, [lastPinClicked]);

  return (
    <div className="w-screen h-screen flex flex-col" style={{ background: '#0d0b09' }}>
      {/* Toolbar */}
      <div
        className="flex items-center gap-3 px-5 py-3 z-10 flex-shrink-0"
        style={{ background: 'rgba(26,21,16,0.95)', borderBottom: '1px solid rgba(139,94,26,0.15)' }}
      >
        {/* Mode switcher */}
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          View
        </span>
        {(['ken-burns', 'split', 'map'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setMapViewMode(mode)}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              padding: '5px 14px',
              borderRadius: 5,
              border: mapViewMode === mode ? '1px solid var(--glow-primary)' : '1px solid rgba(139,94,26,0.2)',
              background: mapViewMode === mode ? 'rgba(196,149,106,0.2)' : 'transparent',
              color: mapViewMode === mode ? 'var(--glow-primary)' : 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            {mode}
          </button>
        ))}

        {/* Segment divider */}
        <div style={{ width: 1, height: 20, background: 'rgba(139,94,26,0.2)', margin: '0 8px' }} />

        {/* Segment switcher */}
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.2em', textTransform: 'uppercase' }}>
          Segment
        </span>
        {MOCK_SEGMENTS.map((s, i) => (
          <button
            key={s.segment.id}
            onClick={() => goToSegment(i)}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              padding: '5px 14px',
              borderRadius: 5,
              border: currentIndex === i ? '1px solid var(--glow-primary)' : '1px solid rgba(139,94,26,0.2)',
              background: currentIndex === i ? 'rgba(196,149,106,0.2)' : 'transparent',
              color: currentIndex === i ? 'var(--glow-primary)' : 'var(--muted)',
              cursor: 'pointer',
              maxWidth: 160,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {s.segment.title}
          </button>
        ))}

        {/* Hints */}
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'rgba(138,122,98,0.5)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
          M = cycle view &middot; &larr;&rarr; = switch segment &middot; Click pins
        </span>
      </div>

      {/* Main area */}
      <div className="flex-1 relative flex overflow-hidden">
        {/* Ken Burns placeholder — shown in ken-burns and split modes */}
        {mapViewMode !== 'map' && (
          <div
            className="h-full flex items-center justify-center"
            style={{
              width: mapViewMode === 'split' ? '50%' : '100%',
              background: 'linear-gradient(135deg, #1a1510 0%, #0d0b09 100%)',
              transition: 'width 0.5s ease',
            }}
          >
            <div className="flex flex-col items-center gap-3 text-center px-8">
              <span style={{ fontFamily: 'var(--font-serif)', fontSize: 22, color: 'var(--glow-primary)', letterSpacing: '0.03em' }}>
                {currentTitle}
              </span>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                Ken Burns Stage
              </span>
              <span style={{ fontFamily: 'var(--font-sans)', fontSize: 12, color: 'rgba(138,122,98,0.4)', maxWidth: 300 }}>
                In the real player, AI-generated images would slowly pan and zoom here
              </span>
            </div>
          </div>
        )}

        {/* Map — shown in map and split modes */}
        {mapViewMode !== 'ken-burns' && (
          <div
            className="h-full"
            style={{
              width: mapViewMode === 'split' ? '50%' : '100%',
              transition: 'width 0.5s ease',
            }}
          >
            <TimelineMap
              onPinClick={(name) => {
                setLastPinClicked(name);
              }}
            />
          </div>
        )}
      </div>

      {/* Pin click notification */}
      {lastPinClicked && (
        <div
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30"
          style={{
            background: 'rgba(26,21,16,0.95)',
            border: '1px solid rgba(196,149,106,0.4)',
            borderRadius: 8,
            padding: '10px 20px',
            fontFamily: 'var(--font-sans)',
            fontSize: 12,
            color: 'var(--glow-primary)',
            letterSpacing: '0.05em',
            animation: 'fadeInUp 0.3s ease',
          }}
        >
          Clicked: <strong>{lastPinClicked}</strong>
          <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 10 }}>
            — would send to historian in real player
          </span>
        </div>
      )}

      <style>{`
        @keyframes fadeInUp {
          from { opacity: 0; transform: translate(-50%, 8px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>
  );
}
