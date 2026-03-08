import { useEffect, useRef } from 'react';
import { useResearchStore } from '../store/researchStore';
import type { SSEEvent } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

/**
 * SSE drip-rate hook.
 *
 * Connects to the session event stream and buffers incoming events,
 * releasing them at 150ms intervals to prevent visual overload from
 * parallel agent bursts.
 */
export function useSSE(sessionId: string | null): void {
  const pendingRef = useRef<SSEEvent[]>([]);
  const setAgent = useResearchStore((s) => s.setAgent);
  const setSegment = useResearchStore((s) => s.setSegment);
  const updateStats = useResearchStore((s) => s.updateStats);
  const addPhaseMessage = useResearchStore((s) => s.addPhaseMessage);
  const setScanEntities = useResearchStore((s) => s.setScanEntities);

  useEffect(() => {
    if (!sessionId) return;

    const es = new EventSource(`${BASE_URL}/api/session/${sessionId}/stream`);

    es.onmessage = (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data as string) as SSEEvent;
        pendingRef.current.push(event);
      } catch {
        /* ignore malformed SSE data */
      }
    };

    // Drip: release one buffered event per 150ms
    const drip = setInterval(() => {
      const event = pendingRef.current.shift();
      if (!event) return;

      switch (event.type) {
        case 'agent_status':
          setAgent(event.agentId, {
            id: event.agentId,
            status: event.status,
            ...(event.query !== undefined && { query: event.query }),
            ...(event.facts !== undefined && { facts: event.facts }),
            ...(event.elapsed !== undefined && { elapsed: event.elapsed }),
          });
          // When scan_agent completes, its facts are entity terms for PDF highlighting
          if (
            event.agentId.startsWith('scan') &&
            event.status === 'done' &&
            event.facts &&
            event.facts.length > 0
          ) {
            setScanEntities(event.facts);
          }
          break;

        case 'segment_update':
          setSegment(event.segmentId, {
            id: event.segmentId,
            status: event.status,
            ...(event.title !== undefined && { title: event.title }),
            ...(event.imageUrls !== undefined && { imageUrls: event.imageUrls }),
            ...(event.videoUrl !== undefined && { videoUrl: event.videoUrl }),
            ...(event.script !== undefined && { script: event.script }),
            ...(event.mood !== undefined && { mood: event.mood }),
          });
          break;

        case 'stats_update':
          updateStats({
            sourcesFound: event.sourcesFound,
            factsVerified: event.factsVerified,
            segmentsReady: event.segmentsReady,
          });
          break;

        case 'pipeline_phase':
          addPhaseMessage(event.phase, event.label, event.message);
          break;

        case 'error':
          // If error targets a specific agent, mark it as errored
          if (event.agentId) {
            setAgent(event.agentId, { status: 'error' });
          }
          break;
      }
    }, 150);

    return () => {
      es.close();
      clearInterval(drip);
      pendingRef.current = [];
    };
  }, [sessionId, setAgent, setSegment, updateStats, addPhaseMessage, setScanEntities]);
}
