import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useResearchStore } from '../store/researchStore';
import { extractGeoData } from '../services/api';
import type { SegmentGeo } from '../types';

/**
 * Extracts geographic data from a segment's script via Gemini Flash.
 * Caches results in playerStore so extraction only runs once per segment.
 */
export function useSegmentGeo(segmentId: string | null): {
  geo: SegmentGeo | null;
  isLoading: boolean;
} {
  const segmentGeo = usePlayerStore((s) => s.segmentGeo);
  const setSegmentGeo = usePlayerStore((s) => s.setSegmentGeo);
  const segments = useResearchStore((s) => s.segments);
  const inFlightRef = useRef<Set<string>>(new Set());

  const geo = segmentId ? segmentGeo[segmentId] ?? null : null;
  const isLoading = segmentId ? inFlightRef.current.has(segmentId) : false;

  useEffect(() => {
    if (!segmentId) return;
    if (segmentGeo[segmentId]) return;
    if (inFlightRef.current.has(segmentId)) return;

    const segment = segments[segmentId];
    if (!segment?.script) return;

    inFlightRef.current.add(segmentId);

    extractGeoData(segmentId, segment.script, segment.title)
      .then((result) => {
        setSegmentGeo(segmentId, result);
      })
      .catch((err) => {
        console.warn('[useSegmentGeo] extraction failed:', err);
      })
      .finally(() => {
        inFlightRef.current.delete(segmentId);
      });
  }, [segmentId, segmentGeo, segments, setSegmentGeo]);

  return { geo, isLoading };
}
