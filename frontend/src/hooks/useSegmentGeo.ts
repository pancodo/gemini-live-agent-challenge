import { useEffect, useRef, useState } from 'react';
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
  const [isLoading, setIsLoading] = useState(false);
  const inFlightRef = useRef<Set<string>>(new Set());

  const geo = segmentId ? segmentGeo[segmentId] ?? null : null;

  useEffect(() => {
    if (!segmentId) return;

    // Read cache via getState() to avoid subscribing to segmentGeo changes
    const cached = usePlayerStore.getState().segmentGeo[segmentId];
    if (cached) return;
    if (inFlightRef.current.has(segmentId)) return;

    const segment = segments[segmentId];
    if (!segment?.script) return;

    const abortController = new AbortController();
    inFlightRef.current.add(segmentId);
    setIsLoading(true);

    extractGeoData(segmentId, segment.script, segment.title, abortController.signal)
      .then((result) => {
        if (!abortController.signal.aborted) {
          setSegmentGeo(segmentId, result);
        }
      })
      .catch((err) => {
        if (!abortController.signal.aborted) {
          console.warn('[useSegmentGeo] extraction failed:', err);
        }
      })
      .finally(() => {
        inFlightRef.current.delete(segmentId);
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [segmentId, segments, setSegmentGeo]);

  return { geo, isLoading };
}
