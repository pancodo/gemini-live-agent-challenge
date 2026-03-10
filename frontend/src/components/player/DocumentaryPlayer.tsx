import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import type { Segment } from '../../types';
import { usePlayerStore } from '../../store/playerStore';
import { useResearchStore } from '../../store/researchStore';
import { useVoiceStore } from '../../store/voiceStore';
import { KenBurnsStage } from './KenBurnsStage';
import { CaptionTrack } from './CaptionTrack';
import { PlayerSidebar } from './PlayerSidebar';

/**
 * DocumentaryPlayer — Full-screen cinematic player.
 *
 * Layers (bottom to top):
 *  1. KenBurnsStage  — background visuals
 *  2. Top bar        — logo, segment index, sidebar toggle (auto-hides)
 *  3. CaptionTrack   — word-by-word captions (always visible)
 *  4. Bottom bar     — navigation controls (auto-hides)
 *  5. PlayerSidebar  — segment list (slides in from right)
 */
export function DocumentaryPlayer() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const shortcutsRef = useRef<HTMLDivElement>(null);
  const shortcutsBtnRef = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const voiceState = useVoiceStore((s) => s.state);
  const setVoiceState = useVoiceStore((s) => s.setState);

  const currentSegmentId = usePlayerStore((s) => s.currentSegmentId);
  const isIdle = usePlayerStore((s) => s.isIdle);
  const setIdle = usePlayerStore((s) => s.setIdle);
  const open = usePlayerStore((s) => s.open);

  const segmentsRecord = useResearchStore((s) => s.segments);

  const segments: Segment[] = useMemo(
    () => Object.values(segmentsRecord),
    [segmentsRecord],
  );

  const readySegments = useMemo(
    () => segments.filter((s) => s.status === 'ready'),
    [segments],
  );

  const currentSegment = currentSegmentId
    ? segmentsRecord[currentSegmentId] ?? null
    : null;

  const currentIndexInReady = useMemo(() => {
    if (!currentSegmentId) return -1;
    return readySegments.findIndex((s) => s.id === currentSegmentId);
  }, [currentSegmentId, readySegments]);

  const hasPrev = currentIndexInReady > 0;
  const hasNext = currentIndexInReady < readySegments.length - 1;

  // ── Idle timer (auto-hide chrome after 3s) ───────────────────
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const reset = () => {
      setIdle(false);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setIdle(true), 3000);
    };

    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('touchstart', reset);
    reset();

    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('touchstart', reset);
      clearTimeout(timerRef.current);
    };
  }, [setIdle]);

  // ── Segment navigation ───────────────────────────────────────
  const navigateSegment = useCallback(
    (direction: 'prev' | 'next') => {
      const targetIndex =
        direction === 'prev'
          ? currentIndexInReady - 1
          : currentIndexInReady + 1;
      const target = readySegments[targetIndex];
      if (!target) return;

      // Use View Transitions API if available, else instant switch
      if (
        typeof document !== 'undefined' &&
        'startViewTransition' in document
      ) {
        (document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(() => {
          open(target.id);
        });
      } else {
        open(target.id);
      }
    },
    [currentIndexInReady, readySegments, open],
  );

  // ── Keyboard navigation ──────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft' && hasPrev) {
        navigateSegment('prev');
      } else if (e.key === 'ArrowRight' && hasNext) {
        navigateSegment('next');
      } else if (e.key === 'Escape') {
        if (sidebarOpen) {
          setSidebarOpen(false);
        } else {
          navigate('/workspace');
        }
      } else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenEnabled) {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen();
          }
        }
      } else if (e.key === ' ') {
        e.preventDefault();
        if (voiceState === 'idle') {
          setVoiceState('listening');
        } else if (voiceState === 'listening') {
          setVoiceState('idle');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasPrev, hasNext, navigateSegment, sidebarOpen, navigate, voiceState, setVoiceState]);

  // ── Click-outside to close shortcuts tooltip ────────────────
  useEffect(() => {
    if (!shortcutsOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        shortcutsRef.current &&
        !shortcutsRef.current.contains(e.target as Node) &&
        shortcutsBtnRef.current &&
        !shortcutsBtnRef.current.contains(e.target as Node)
      ) {
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [shortcutsOpen]);

  // ── Chrome opacity/transform ─────────────────────────────────
  const chromeStyle = {
    opacity: isIdle ? 0 : 1,
    transition: 'opacity 0.5s ease, transform 0.5s ease',
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden player-root select-none">
      {/* View Transition CSS */}
      <style>{`
        ::view-transition-old(root) {
          animation: 0.35s ease-in both fade-and-scale-out;
        }
        ::view-transition-new(root) {
          animation: 0.35s ease-out both fade-and-scale-in;
        }
        @keyframes fade-and-scale-out {
          to { opacity: 0; filter: brightness(0); transform: scale(1); }
        }
        @keyframes fade-and-scale-in {
          from { opacity: 0; filter: brightness(0); transform: scale(1.03); }
          to   { opacity: 1; filter: brightness(1); transform: scale(1); }
        }
      `}</style>

      {/* Layer 1: Ken Burns Stage */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentSegmentId ?? 'empty'}
          initial={{ opacity: 0, scale: 1.03 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeInOut' }}
          className="absolute inset-0"
        >
          <KenBurnsStage segment={currentSegment} />
        </motion.div>
      </AnimatePresence>

      {/* Layer 2: Top bar */}
      <div
        className="absolute top-0 left-0 right-0 z-10 archival-frame"
        style={chromeStyle}
      >
        <div
          className="flex items-center justify-between px-8 py-5"
          style={{
            background:
              'linear-gradient(to bottom, rgba(13,11,9,0.7) 0%, transparent 100%)',
          }}
        >
          {/* Logo */}
          <span
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: 10,
              letterSpacing: '0.5em',
              textTransform: 'uppercase',
              color: 'var(--glow-primary)',
            }}
          >
            AI Historian
          </span>

          <div className="flex items-center gap-4">
            {/* Segment index */}
            {readySegments.length > 0 && (
              <span
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 11,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: 'rgba(232,221,208,0.5)',
                }}
              >
                {currentIndexInReady >= 0 ? currentIndexInReady + 1 : '-'}
                {' / '}
                {readySegments.length}
              </span>
            )}

            {/* Shortcuts hint */}
            <div className="relative">
              <button
                ref={shortcutsBtnRef}
                onClick={() => setShortcutsOpen((o) => !o)}
                className="p-2 rounded transition-colors duration-200"
                style={{
                  color: 'rgba(232,221,208,0.6)',
                  background: 'transparent',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 13,
                  lineHeight: 1,
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Keyboard shortcuts"
              >
                ?
              </button>
              {shortcutsOpen && (
                <div
                  ref={shortcutsRef}
                  className="absolute top-full right-0 mt-2 rounded-lg p-3 z-50"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid rgba(214,204,186,0.4)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    color: 'rgba(232,221,208,0.7)',
                    whiteSpace: 'pre',
                    lineHeight: 1.8,
                    minWidth: 200,
                  }}
                >
                  {'← →   Previous / Next chapter\n'}
                  {'Space  Toggle voice\n'}
                  {'F      Fullscreen\n'}
                  {'Esc    Back to workspace'}
                </div>
              )}
            </div>

            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="p-2 rounded transition-colors duration-200"
              style={{
                color: 'rgba(232,221,208,0.6)',
                background: 'transparent',
              }}
              aria-label="Toggle segment sidebar"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="3" y1="4" x2="15" y2="4" />
                <line x1="3" y1="9" x2="15" y2="9" />
                <line x1="3" y1="14" x2="15" y2="14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Layer 3: Captions — always visible */}
      <div className="absolute bottom-24 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <CaptionTrack />
      </div>

      {/* Layer 4: Bottom bar */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10"
        style={{
          ...chromeStyle,
          transform: isIdle ? 'translateY(20px)' : 'translateY(0)',
        }}
      >
        <div
          className="flex items-center justify-between px-8 py-5"
          style={{
            background:
              'linear-gradient(to top, rgba(13,11,9,0.7) 0%, transparent 100%)',
          }}
        >
          {/* Prev */}
          <button
            onClick={() => navigateSegment('prev')}
            disabled={!hasPrev}
            className="flex items-center gap-2 transition-opacity duration-200"
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 400,
              fontSize: 11,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: hasPrev ? 'rgba(232,221,208,0.7)' : 'rgba(232,221,208,0.2)',
              cursor: hasPrev ? 'pointer' : 'default',
              background: 'transparent',
              border: 'none',
            }}
            aria-label="Previous segment"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 2L4 7L9 12" />
            </svg>
            Prev
          </button>

          {/* Current segment title */}
          <span
            className="text-center max-w-md truncate"
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: 14,
              color: 'rgba(232,221,208,0.6)',
            }}
          >
            {currentSegment?.title ?? ''}
          </span>

          <div className="flex items-center gap-4">
            {/* Next */}
            <button
              onClick={() => navigateSegment('next')}
              disabled={!hasNext}
              className="flex items-center gap-2 transition-opacity duration-200"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: 11,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: hasNext ? 'rgba(232,221,208,0.7)' : 'rgba(232,221,208,0.2)',
                cursor: hasNext ? 'pointer' : 'default',
                background: 'transparent',
                border: 'none',
              }}
              aria-label="Next segment"
            >
              Next
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 2L10 7L5 12" />
              </svg>
            </button>

            {/* Segments button */}
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="flex items-center gap-2 transition-opacity duration-200"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: 11,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'rgba(232,221,208,0.5)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              aria-label="Open segments panel"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="2" y1="3" x2="12" y2="3" />
                <line x1="2" y1="7" x2="12" y2="7" />
                <line x1="2" y1="11" x2="12" y2="11" />
              </svg>
              Segments
            </button>
          </div>
        </div>
      </div>

      {/* Layer 5: Sidebar */}
      <PlayerSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
    </div>
  );
}
