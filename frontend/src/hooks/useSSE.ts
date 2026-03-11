import { useEffect, useRef, useCallback, startTransition } from 'react';
import { useResearchStore } from '../store/researchStore';
import type { SSEEvent } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';
const MAX_RETRIES = 5;
const MAX_BACKOFF_MS = 30_000;

/**
 * SSE drip-rate hook with exponential backoff reconnection.
 *
 * Connects to the session event stream and buffers incoming events,
 * releasing them at 150ms intervals (wrapped in startTransition) to
 * prevent visual overload from parallel agent bursts.
 *
 * On connection loss, retries up to MAX_RETRIES times with exponential
 * backoff (capped at 30s) plus 30% jitter. Retry count resets on any
 * successful message receipt. All pending timers are cancelled on unmount.
 */
export function useSSE(sessionId: string | null): void {
  const pendingRef = useRef<SSEEvent[]>([]);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const setAgent = useResearchStore((s) => s.setAgent);
  const setSegment = useResearchStore((s) => s.setSegment);
  const updateStats = useResearchStore((s) => s.updateStats);
  const addPhaseMessage = useResearchStore((s) => s.addPhaseMessage);
  const setScanEntities = useResearchStore((s) => s.setScanEntities);
  const addEvaluatedSource = useResearchStore((s) => s.addEvaluatedSource);

  const processEvent = useCallback(
    (event: SSEEvent) => {
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

        case 'agent_source_evaluation':
          addEvaluatedSource(event.agentId, event.source);
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
    },
    [setAgent, setSegment, updateStats, addPhaseMessage, setScanEntities, addEvaluatedSource],
  );

  useEffect(() => {
    if (!sessionId) return;

    function connect(): EventSource {
      const url = `${BASE_URL}/api/session/${sessionId}/stream`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onmessage = (e: MessageEvent) => {
        try {
          const event = JSON.parse(e.data as string) as SSEEvent;
          retryCountRef.current = 0; // reset on successful message
          pendingRef.current.push(event);
        } catch {
          /* ignore malformed SSE data */
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;

        if (retryCountRef.current < MAX_RETRIES) {
          const base = Math.min(1000 * 2 ** retryCountRef.current, MAX_BACKOFF_MS);
          const jitter = base * 0.3 * Math.random();
          const delay = base + jitter;

          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            retryCountRef.current++;
            connect();
          }, delay);
        }
      };

      return es;
    }

    connect();

    // Drip: release one buffered event per 150ms, wrapped in startTransition
    const drip = setInterval(() => {
      const event = pendingRef.current.shift();
      if (!event) return;

      startTransition(() => {
        processEvent(event);
      });
    }, 150);

    return () => {
      // Cancel any pending retry timer
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      // Close active EventSource
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }

      clearInterval(drip);
      pendingRef.current = [];
      retryCountRef.current = 0;
    };
  }, [sessionId, processEvent]);
}
