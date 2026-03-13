import { useState, useEffect, useCallback, useMemo, useRef, useTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore } from '../../store/playerStore';
import { useResearchStore } from '../../store/researchStore';
import { useVoiceStore } from '../../store/voiceStore';
import { useMediaSession } from '../../hooks/useMediaSession';
import { KenBurnsStage } from './KenBurnsStage';
import { CaptionTrack } from './CaptionTrack';
import { PlayerSidebar } from './PlayerSidebar';
import { ShareButton } from './ShareButton';
import { useSessionStore } from '../../store/sessionStore';
import { downloadImage, downloadImages, downloadVideo } from '../../utils/downloadImage';

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
  const [isSavingAll, startSaveAllTransition] = useTransition();
  const shortcutsRef = useRef<HTMLDivElement>(null);
  const shortcutsBtnRef = useRef<HTMLButtonElement>(null);
  /** Tracks the URL of whichever image KenBurnsStage is currently showing. */
  const activeImageUrlRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const sessionId = useSessionStore((s) => s.sessionId);
  const currentSegmentId = usePlayerStore((s) => s.currentSegmentId);
  const liveIllustration = usePlayerStore((s) => s.liveIllustration);
  const isIdle = usePlayerStore((s) => s.isIdle);
  const open = usePlayerStore((s) => s.open);

  // Narrowed subscriptions — only get ready segments to avoid re-renders on
  // intermediate status updates (generating, etc.)
  const readySegments = useResearchStore(
    useShallow((s) =>
      Object.values(s.segments).filter(
        (seg) => seg.status === 'ready' || seg.status === 'complete' || seg.status === 'visual_ready',
      )
    )
  );

  const currentSegment = useResearchStore(
    (s) => (currentSegmentId ? s.segments[currentSegmentId] ?? null : null)
  );

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
      usePlayerStore.getState().setIdle(false);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => usePlayerStore.getState().setIdle(true), 3000);
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
  }, []);

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

  // ── Media Session API (OS-level transport controls) ──────────
  const goNext = useCallback(() => navigateSegment('next'), [navigateSegment]);
  const goPrev = useCallback(() => navigateSegment('prev'), [navigateSegment]);

  // ── Download helpers ─────────────────────────────────────────
  const handleActiveImageChange = useCallback((url: string | null) => {
    activeImageUrlRef.current = url;
  }, []);

  const handleDownloadCurrent = useCallback(() => {
    const url = activeImageUrlRef.current;
    if (!url) return;
    const slug = currentSegment?.title
      ? currentSegment.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
      : 'frame';
    void downloadImage(url, `ai-historian-${slug}.jpg`);
  }, [currentSegment?.title]);

  const handleSaveAll = useCallback(() => {
    const urls = currentSegment?.imageUrls;
    if (!urls || urls.length === 0) return;
    const slug = currentSegment.title
      ? currentSegment.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
      : 'scene';
    startSaveAllTransition(() => {
      void downloadImages(urls, `ai-historian-${slug}`, 500);
    });
  }, [currentSegment?.imageUrls, currentSegment?.title]);

  const handleDownloadVideo = useCallback(() => {
    const videoUrl = currentSegment?.videoUrl;
    if (!videoUrl) return;
    const slug = currentSegment.title
      ? currentSegment.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
      : 'scene';
    void downloadVideo(videoUrl, `ai-historian-${slug}-video.mp4`);
  }, [currentSegment?.videoUrl, currentSegment?.title]);

  useMediaSession(currentSegment, {
    onNextTrack: hasNext ? goNext : undefined,
    onPreviousTrack: hasPrev ? goPrev : undefined,
  });

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
        const vs = useVoiceStore.getState().state;
        if (vs === 'idle') {
          useVoiceStore.getState().setState('listening');
        } else if (vs === 'listening') {
          useVoiceStore.getState().setState('idle');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasPrev, hasNext, navigateSegment, sidebarOpen, navigate]);

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

  return (
    <div className="relative w-screen h-screen overflow-hidden player-root select-none" style={{ background: '#0d0b09' }}>
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
          <KenBurnsStage
            segment={currentSegment}
            onActiveImageChange={handleActiveImageChange}
          />
        </motion.div>
      </AnimatePresence>

      {/* Layer 2: Top bar */}
      <div
        className={`absolute top-0 left-0 right-0 z-10 archival-frame player-chrome${isIdle ? ' player-chrome--idle' : ''}`}
      >
        <div
          className="flex items-center justify-between px-8 py-5"
          style={{
            background:
              'linear-gradient(to bottom, rgba(13,11,9,0.7) 0%, transparent 100%)',
          }}
        >
          {/* Left: Back button */}
          <div className="flex items-center gap-3 min-w-[80px]">
            <button
              onClick={() => navigate('/workspace')}
              className="p-2 rounded transition-colors duration-200 hover:text-[rgba(232,221,208,0.9)]"
              style={{
                color: 'rgba(232,221,208,0.6)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              aria-label="Back to workspace"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 4L6 8L10 12" />
              </svg>
            </button>
          </div>

          {/* Center: Logo */}
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

          {/* Illustration badge */}
          <AnimatePresence>
            {liveIllustration && (
              <motion.span
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                style={{
                  position: 'absolute',
                  top: 20,
                  right: 80,
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 10,
                  letterSpacing: '0.2em',
                  textTransform: 'uppercase' as const,
                  color: 'var(--gold)',
                  zIndex: 20,
                }}
              >
                &#10022; Illustrated
              </motion.span>
            )}
          </AnimatePresence>

          {/* Right: Controls */}
          <div className="flex items-center gap-4 min-w-[80px] justify-end">
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
                    background: 'var(--bg2)',
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

      {/* Layer 3b: Illustration caption */}
      <AnimatePresence>
        {liveIllustration?.caption && (
          <motion.div
            key="illustration-caption"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 0.85, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute bottom-16 left-0 right-0 flex justify-center z-10 pointer-events-none"
          >
            <p
              className="text-center"
              style={{
                maxWidth: 700,
                fontFamily: 'var(--font-serif)',
                fontWeight: 300,
                fontStyle: 'italic',
                fontSize: 16,
                letterSpacing: '0.03em',
                color: 'var(--gold)',
                textShadow: '0 1px 12px rgba(0,0,0,0.7)',
              }}
            >
              {liveIllustration.caption}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layer 4: Bottom bar */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-10 player-chrome player-chrome-bottom${isIdle ? ' player-chrome--idle player-chrome-bottom--idle' : ''}`}
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

            {/* Download current image */}
            {(currentSegment?.imageUrls?.length ?? 0) > 0 && (
              <button
                onClick={handleDownloadCurrent}
                title="Download image"
                aria-label="Download current image"
                className="flex items-center justify-center transition-colors duration-200 hover:bg-[rgba(196,149,106,0.22)] hover:border-[rgba(196,149,106,0.55)]"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  border: '1px solid rgba(196,149,106,0.25)',
                  background: 'rgba(196,149,106,0.10)',
                  color: 'var(--glow-primary)',
                  cursor: 'pointer',
                }}
              >
                {/* Download-arrow icon */}
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6.5 1v8M3.5 6.5l3 2.5 3-2.5" />
                  <path d="M1.5 11.5h10" />
                </svg>
              </button>
            )}

            {/* Save all images */}
            {(currentSegment?.imageUrls?.length ?? 0) > 1 && (
              <button
                onClick={handleSaveAll}
                disabled={isSavingAll}
                title={
                  isSavingAll
                    ? 'Saving…'
                    : `Save all ${currentSegment!.imageUrls.length} images`
                }
                aria-label="Save all images"
                className="flex items-center gap-1.5 transition-colors duration-200 hover:bg-[rgba(196,149,106,0.22)] hover:border-[rgba(196,149,106,0.55)]"
                style={{
                  height: 30,
                  padding: '0 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(196,149,106,0.25)',
                  background: isSavingAll
                    ? 'rgba(196,149,106,0.18)'
                    : 'rgba(196,149,106,0.10)',
                  color: isSavingAll
                    ? 'rgba(196,149,106,0.55)'
                    : 'var(--glow-primary)',
                  cursor: isSavingAll ? 'default' : 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
              >
                {isSavingAll ? (
                  <>
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 11 11"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5.5 1v3M8.5 2.5l-2 2M10 5.5H7M8.5 8.5l-2-2M5.5 10V7M2.5 8.5l2-2M1 5.5h3M2.5 2.5l2 2" />
                    </svg>
                    Saving
                  </>
                ) : (
                  <>
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 11 11"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="1" y="1" width="9" height="9" rx="1.5" />
                      <path d="M3.5 6l2 2 2-2" />
                      <path d="M5.5 3v5" />
                    </svg>
                    Save all
                  </>
                )}
              </button>
            )}

            {/* Download video */}
            {currentSegment?.videoUrl && (
              <button
                onClick={handleDownloadVideo}
                title="Download video"
                aria-label="Download video"
                className="flex items-center justify-center transition-colors duration-200 hover:bg-[rgba(196,149,106,0.22)] hover:border-[rgba(196,149,106,0.55)]"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  border: '1px solid rgba(196,149,106,0.25)',
                  background: 'rgba(196,149,106,0.10)',
                  color: 'var(--glow-primary)',
                  cursor: 'pointer',
                }}
              >
                {/* Film/video download icon */}
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="1.5" y="2.5" width="10" height="8" rx="1.5" />
                  <path d="M5 5.5l3 1.5-3 1.5z" fill="currentColor" stroke="none" />
                </svg>
              </button>
            )}

            <ShareButton sessionId={sessionId} segmentId={currentSegmentId} />
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
