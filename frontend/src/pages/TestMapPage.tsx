import { useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useResearchStore } from '../store/researchStore';
import { TimelineMap } from '../components/player/TimelineMap';
import type { SegmentGeo } from '../types';

const MOCK_SEGMENT_ID = 'test-seg-1';

const MOCK_GEO: SegmentGeo = {
  segmentId: MOCK_SEGMENT_ID,
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
};

/**
 * Test page for the TimelineMap component.
 * Visit /test-map to see the map with mock historical data.
 */
export function TestMapPage() {
  const setSegmentGeo = usePlayerStore((s) => s.setSegmentGeo);
  const open = usePlayerStore((s) => s.open);
  const setSegment = useResearchStore((s) => s.setSegment);
  const mapViewMode = usePlayerStore((s) => s.mapViewMode);
  const setMapViewMode = usePlayerStore((s) => s.setMapViewMode);

  useEffect(() => {
    // Seed mock segment so useSegmentGeo finds it
    setSegment(MOCK_SEGMENT_ID, {
      id: MOCK_SEGMENT_ID,
      title: 'The Fall of Constantinople',
      status: 'ready',
      imageUrls: [],
      script: 'Constantinople fell to the Ottoman Turks in 1453...',
      mood: 'dramatic',
      sources: [],
      graphEdges: [],
    });
    // Pre-load geo data so the map renders immediately
    setSegmentGeo(MOCK_SEGMENT_ID, MOCK_GEO);
    open(MOCK_SEGMENT_ID);
  }, [setSegment, setSegmentGeo, open]);

  return (
    <div className="w-screen h-screen flex flex-col" style={{ background: '#0d0b09' }}>
      {/* Mode switcher */}
      <div className="flex items-center gap-3 p-4 z-10" style={{ background: 'rgba(26,21,16,0.9)' }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          Map Test
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
              padding: '4px 12px',
              borderRadius: 4,
              border: mapViewMode === mode ? '1px solid var(--glow-primary)' : '1px solid rgba(139,94,26,0.2)',
              background: mapViewMode === mode ? 'rgba(196,149,106,0.2)' : 'transparent',
              color: mapViewMode === mode ? 'var(--glow-primary)' : 'var(--muted)',
              cursor: 'pointer',
            }}
          >
            {mode}
          </button>
        ))}
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 10, color: 'var(--muted)', marginLeft: 'auto' }}>
          Click pins to test interaction &middot; Press M to cycle modes
        </span>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <TimelineMap
          onPinClick={(name) => {
            // eslint-disable-next-line no-alert
            alert(`Pin clicked: ${name}\n\nIn the real player, this would send "${name}" to the historian via voice.`);
          }}
        />
      </div>
    </div>
  );
}
