import { useState } from 'react';
import { usePlayerStore } from '../store/playerStore';
import type { SegmentGeo } from '../types';

/**
 * Provides geographic metadata for a documentary segment.
 *
 * Data comes from the backend pipeline (Phase 3.8) via:
 * 1. SSE `geo_update` event → `playerStore.segmentGeo` (real-time)
 * 2. REST `/segments` response → `playerStore.segmentGeo` (hydration)
 *
 * No client-side Gemini calls — the pipeline is the single source of truth.
 */
export function useSegmentGeo(segmentId: string | null): {
  geo: SegmentGeo | null;
  isLoading: boolean;
} {
  const geo = usePlayerStore((s) => segmentId ? s.segmentGeo[segmentId] ?? null : null);
  // Loading state kept for API compatibility but always false — data arrives via store
  const [isLoading] = useState(false);

  return { geo, isLoading };
}
