/**
 * usePDFHighlights -- subscribes to currentSegmentId changes and returns
 * the EntityHighlight[] for the active segment.
 *
 * Reads from researchStore which is populated by the SSE stream when
 * entity highlights are extracted during Phase III (script generation).
 */
import { usePlayerStore } from '../store/playerStore';
import { useResearchStore } from '../store/researchStore';
import type { EntityHighlight } from '../types';

export function usePDFHighlights(): EntityHighlight[] {
  const currentSegmentId = usePlayerStore((s) => s.currentSegmentId);
  const entityHighlights = useResearchStore((s) => s.entityHighlights);
  if (!currentSegmentId) return [];
  return entityHighlights[currentSegmentId] ?? [];
}
