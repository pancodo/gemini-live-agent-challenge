/**
 * useClipGeneration -- manages clip generation for a segment.
 * POST to create, polls GET every 3s until ready, then triggers download.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import type { ClipStatus } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export function useClipGeneration(sessionId: string | null) {
  const [clipStatus, setClipStatus] = useState<ClipStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
      }
    };
  }, []);

  const generateClip = useCallback(
    async (segmentId: string) => {
      if (!sessionId) return;

      const toastId = toast.loading('Generating shareable clip...');

      try {
        const res = await fetch(`${BASE_URL}/api/session/${sessionId}/clips`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segmentId }),
        });
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const { clipId } = (await res.json()) as { clipId: string };

        setClipStatus({ clipId, status: 'generating', segmentId });

        // Clear any existing poll
        if (pollRef.current) {
          clearInterval(pollRef.current);
        }

        // Poll every 3s
        pollRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch(
              `${BASE_URL}/api/session/${sessionId}/clips/${clipId}`,
            );
            if (!statusRes.ok) return;
            const status = (await statusRes.json()) as ClipStatus;
            setClipStatus(status);

            if (status.status === 'ready' && status.downloadUrl) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              toast.success('Clip ready!', { id: toastId });
              // Trigger download
              const a = document.createElement('a');
              a.href = status.downloadUrl;
              a.download = `ai-historian-clip-${segmentId}.mp4`;
              a.click();
            } else if (status.status === 'error') {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              toast.error('Clip generation failed', { id: toastId });
            }
          } catch {
            /* ignore transient poll errors */
          }
        }, 3000);
      } catch {
        toast.error('Could not start clip generation', { id: toastId });
      }
    },
    [sessionId],
  );

  return { clipStatus, generateClip };
}
