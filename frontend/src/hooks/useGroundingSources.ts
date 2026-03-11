/**
 * useGroundingSources — fetches grounding sources for the active segment.
 * Refetches when currentSegmentId changes.
 */

import { useQuery } from '@tanstack/react-query';
import { usePlayerStore } from '../store/playerStore';
import { useSessionStore } from '../store/sessionStore';
import type { GroundingSource } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

interface GroundingSourcesResponse {
  sources: GroundingSource[];
}

export function useGroundingSources(): GroundingSource[] {
  const sessionId = useSessionStore((s) => s.sessionId);
  const segmentId = usePlayerStore((s) => s.currentSegmentId);

  const { data } = useQuery<GroundingSourcesResponse>({
    queryKey: ['sources', sessionId, segmentId],
    queryFn: async () => {
      if (!sessionId || !segmentId) return { sources: [] };
      const res = await fetch(
        `${BASE_URL}/api/session/${sessionId}/segments/${segmentId}/sources`,
      );
      if (!res.ok) return { sources: [] };
      return res.json() as Promise<GroundingSourcesResponse>;
    },
    enabled: !!sessionId && !!segmentId,
    staleTime: 60_000,
  });

  return data?.sources ?? [];
}
