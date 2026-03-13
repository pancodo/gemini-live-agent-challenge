import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useResearchStore } from '../store/researchStore';
import { extractGeoData } from '../services/api';
import type { SegmentGeo } from '../types';

/**
 * Provides geographic metadata for a documentary segment.
 *
 * Data source priority:
 * 1. SSE-delivered geo data from the backend pipeline (Phase 3.8)
 *    — arrives via `geo_update` SSE event → `playerStore.segmentGeo`
 * 2. Client-side Gemini Flash extraction (fallback after 8s timeout)
 *    — for sessions started before Phase 3.8 was deployed, or if
 *      the pipeline hasn't reached that phase yet when the player opens.
 */
export function useSegmentGeo(segmentId: string | null): {
  geo: SegmentGeo | null;
  isLoading: boolean;
} {
  const segmentGeo = usePlayerStore((s) => s.segmentGeo);
  const setSegmentGeo = usePlayerStore((s) => s.setSegmentGeo);
  const segment = useResearchStore((s) => segmentId ? s.segments[segmentId] : null);
  const [isLoading, setIsLoading] = useState(false);
  const inFlightRef = useRef<Set<string>>(new Set());

  const geo = segmentId ? segmentGeo[segmentId] ?? null : null;

  useEffect(() => {
    if (!segmentId) return;

    // Already have geo data (from SSE or previous extraction)
    const cached = usePlayerStore.getState().segmentGeo[segmentId];
    if (cached) return;
    if (inFlightRef.current.has(segmentId)) return;
    if (!segment?.script) return;

    // Wait 8 seconds for SSE-delivered geo data before falling back
    // to client-side extraction. This gives the backend pipeline time
    // to deliver Phase 3.8 results via the geo_update SSE event.
    const abortController = new AbortController();
    inFlightRef.current.add(segmentId);

    const fallbackTimer = setTimeout(() => {
      // Check again — SSE data may have arrived during the wait
      const arrived = usePlayerStore.getState().segmentGeo[segmentId];
      if (arrived || abortController.signal.aborted) {
        inFlightRef.current.delete(segmentId);
        return;
      }

      // No SSE data arrived — fall back to client-side extraction
      setIsLoading(true);
      extractGeoData(segmentId, segment.script, segment.title ?? '', abortController.signal)
        .then((result) => {
          if (!abortController.signal.aborted) {
            setSegmentGeo(segmentId, result);
          }
        })
        .catch((err) => {
          if (!abortController.signal.aborted) {
            console.warn('[useSegmentGeo] client-side fallback failed:', err);
          }
        })
        .finally(() => {
          inFlightRef.current.delete(segmentId);
          if (!abortController.signal.aborted) {
            setIsLoading(false);
          }
        });
    }, 8_000);

    return () => {
      clearTimeout(fallbackTimer);
      abortController.abort();
      inFlightRef.current.delete(segmentId);
      setIsLoading(false);
    };
  }, [segmentId, segment, setSegmentGeo]);

  return { geo, isLoading };
}
