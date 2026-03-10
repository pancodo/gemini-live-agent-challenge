import { useEffect, useMemo, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { WorkspaceLayout } from '../components/workspace/WorkspaceLayout';
import { ResearchPanel } from '../components/workspace/ResearchPanel';
import { ExpeditionLog } from '../components/workspace/ExpeditionLog';
import { useSessionStore } from '../store/sessionStore';
import { useResearchStore } from '../store/researchStore';
import { usePlayerStore } from '../store/playerStore';
import { useSession } from '../hooks/useSession';
import { useSSE } from '../hooks/useSSE';
import { useSettings } from '../hooks/useSettings';
import { getSegments } from '../services/api';

function ReadyBanner() {
  const status = useSessionStore((s) => s.status);
  const segments = useResearchStore((s) => s.segments);
  const triggerIris = usePlayerStore((s) => s.triggerIris);

  const readySegments = useMemo(
    () => Object.values(segments).filter((s) => s.status === 'ready' || s.status === 'complete'),
    [segments],
  );

  const firstReadyId = readySegments[0]?.id ?? null;
  const chapterCount = readySegments.length;

  if (status !== 'ready' && status !== 'playing') return null;

  // Pipeline done but no segments ready yet
  if (chapterCount === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        className="flex items-center gap-3 px-4 py-3 rounded-lg border-l-2 border-[var(--bg3)] bg-[var(--bg2)]"
      >
        <span className="block w-1.5 h-1.5 rounded-full bg-[var(--muted)] animate-pulse" />
        <span className="text-[12px] text-[var(--muted)] font-sans tracking-wide">
          Preparing your documentary&hellip;
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 22 }}
      className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg border-l-2 border-[var(--gold)] bg-[var(--bg2)]"
    >
      <div className="flex items-center gap-3">
        <motion.span
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 14 }}
          className="block w-2 h-2 rounded-full bg-[var(--gold)]"
        />
        <span className="text-[12px] text-[var(--text)] font-sans tracking-wide">
          Documentary ready
          <span className="text-[var(--muted)] mx-1.5">&middot;</span>
          {chapterCount} {chapterCount === 1 ? 'chapter' : 'chapters'}
        </span>
      </div>

      {firstReadyId && (
        <button
          type="button"
          onClick={() => triggerIris(`/player/${firstReadyId}`)}
          className="text-[12px] font-sans font-medium text-[var(--gold)] tracking-wide hover:text-[var(--gold-d)] transition-colors cursor-pointer whitespace-nowrap"
        >
          Watch Documentary &rarr;
        </button>
      )}
    </motion.div>
  );
}

export function WorkspacePage() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const status = useSessionStore((s) => s.status);
  const setSegment = useResearchStore((s) => s.setSegment);
  const segments = useResearchStore((s) => s.segments);
  const triggerIrisWs = usePlayerStore((s) => s.triggerIris);
  const [settings] = useSettings();
  const autoWatchFired = useRef(false);
  useSession(sessionId);
  useSSE(sessionId);

  // When pipeline finishes, fetch full segments from Firestore (with signed image URLs)
  useEffect(() => {
    if ((status === 'ready' || status === 'playing') && sessionId) {
      getSegments(sessionId).then((segs) => {
        for (const seg of segs) {
          setSegment(seg.id, seg);
        }
      }).catch(() => {/* non-fatal */});
    }
  }, [status, sessionId, setSegment]);

  // Auto-watch: navigate to player when status is ready/playing (if enabled).
  // Works on mount if status is already 'ready' — no transition needed.
  // Resets the fired flag when the setting is toggled off so re-enabling fires again.
  useEffect(() => {
    if (!settings.autoWatch) {
      autoWatchFired.current = false;
      return;
    }
    if (autoWatchFired.current) return;
    if (status !== 'ready' && status !== 'playing') return;

    const readySegment = Object.values(segments).find(
      (s) => s.status === 'ready' || s.status === 'complete',
    );
    if (!readySegment) return;

    autoWatchFired.current = true;
    triggerIrisWs(`/player/${readySegment.id}`);
  }, [settings.autoWatch, status, segments, triggerIrisWs]);

  if (!sessionId) return <Navigate to="/" replace />;

  return (
    <>
      <WorkspaceLayout>
        {/* Right panel — content switches on session status */}
        <div className="flex flex-col h-full">
          {status === 'processing' && <ExpeditionLog />}

          {(status === 'ready' || status === 'playing') && (
            <div className="flex flex-col h-full">
              <div className="shrink-0 px-3 pt-3">
                <ReadyBanner />
              </div>
              <div className="flex-1 overflow-y-auto">
                <ResearchPanel />
              </div>
            </div>
          )}

          {(status === 'idle' || status === 'uploading') && (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] opacity-60 animate-pulse" />
              <p className="text-[11px] text-[var(--muted)] font-sans uppercase tracking-[0.2em]">
                Preparing document…
              </p>
            </div>
          )}
        </div>
      </WorkspaceLayout>
    </>
  );
}
