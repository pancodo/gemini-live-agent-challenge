import {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useMotionValue, useSpring, useReducedMotion } from 'motion/react';
import { Badge, Button } from '../ui';
import { usePlayerStore } from '../../store/playerStore';
import { useTextScramble } from '../../hooks/useTextScramble';
import { downloadImage } from '../../utils/downloadImage';
import type { Segment } from '../../types';

// ── Lightbox ─────────────────────────────────────────────────────

interface LightboxProps {
  urls: string[];
  initialIndex: number;
  onClose: () => void;
}

function Lightbox({ urls, initialIndex, onClose }: LightboxProps) {
  const [current, setCurrent] = useState(initialIndex);

  const handlePrev = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setCurrent((i) => (i - 1 + urls.length) % urls.length);
    },
    [urls.length],
  );

  const handleNext = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      setCurrent((i) => (i + 1) % urls.length);
    },
    [urls.length],
  );

  const handleDownload = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const url = urls[current];
      void downloadImage(url, `scene-${current + 1}.jpg`);
    },
    [urls, current],
  );

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') setCurrent((i) => (i - 1 + urls.length) % urls.length);
      if (e.key === 'ArrowRight') setCurrent((i) => (i + 1) % urls.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, urls.length]);

  const hasMultiple = urls.length > 1;

  const lightbox = (
    <AnimatePresence>
      <motion.div
        key="lightbox-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-[9999] bg-black/90 flex items-center justify-center"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Image lightbox"
      >
        {/* Image container — stops propagation so clicking the image itself doesn't close */}
        <motion.div
          key={current}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          className="relative flex flex-col items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={urls[current]}
            alt={`Scene ${current + 1} of ${urls.length}`}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
          />

          {/* Bottom bar: index + download */}
          <div
            className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-4 py-2 rounded-b-lg"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)' }}
          >
            {/* Index */}
            <span
              className="font-sans text-[11px] uppercase tracking-[0.2em]"
              style={{ color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}
            >
              {current + 1} / {urls.length}
            </span>

            {/* Download button */}
            <button
              onClick={handleDownload}
              className="font-sans text-[10px] uppercase tracking-[0.18em] px-3 py-1.5 rounded transition-opacity hover:opacity-80 active:opacity-60"
              style={{
                color: 'var(--gold)',
                background: 'var(--bg2)',
                border: '1px solid var(--bg4)',
              }}
            >
              Download
            </button>
          </div>
        </motion.div>

        {/* Navigation arrows */}
        {hasMultiple && (
          <>
            <button
              onClick={handlePrev}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full transition-opacity hover:opacity-80 active:opacity-60"
              style={{ background: 'var(--bg2)', border: '1px solid var(--bg4)', color: 'var(--gold)' }}
              aria-label="Previous image"
            >
              <span className="text-lg leading-none">&#8592;</span>
            </button>
            <button
              onClick={handleNext}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center rounded-full transition-opacity hover:opacity-80 active:opacity-60"
              style={{ background: 'var(--bg2)', border: '1px solid var(--bg4)', color: 'var(--gold)' }}
              aria-label="Next image"
            >
              <span className="text-lg leading-none">&#8594;</span>
            </button>
          </>
        )}

        {/* Close button (top-right) */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full font-sans text-sm transition-opacity hover:opacity-80 active:opacity-60"
          style={{ background: 'var(--bg2)', border: '1px solid var(--bg4)', color: 'var(--muted)' }}
          aria-label="Close lightbox"
        >
          &#10005;
        </button>
      </motion.div>
    </AnimatePresence>
  );

  return createPortal(lightbox, document.body);
}

// ── Props ───────────────────────────────────────────────────────

interface SegmentCardProps {
  segment: Segment;
  index: number;
}

// ── Component ───────────────────────────────────────────────────

export const SegmentCard = memo(function SegmentCard({ segment, index }: SegmentCardProps) {
  const triggerIris = usePlayerStore((s) => s.triggerIris);
  const reducedMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);

  // Lightbox state: index of the open image (-1 = closed)
  const [lightboxIndex, setLightboxIndex] = useState<number>(-1);

  // Magnetic pull motion values (must be unconditional)
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const springX = useSpring(mx, { stiffness: 150, damping: 15 });
  const springY = useSpring(my, { stiffness: 150, damping: 15 });
  const isReady = segment.status === 'ready' || segment.status === 'complete' || segment.status === 'visual_ready';
  const [hasBeenReady, setHasBeenReady] = useState(isReady);

  // Track transition to ready/complete for cipher reveal
  useEffect(() => {
    if (isReady && !hasBeenReady) {
      setHasBeenReady(true);
    }
  }, [isReady, hasBeenReady]);

  // Cipher reveal activates only on the transition from generating -> ready
  const scrambledTitle = useTextScramble(
    segment.title,
    hasBeenReady && !reducedMotion,
  );

  // Spotlight glow: track mouse position on card
  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    cardRef.current.style.setProperty('--mouse-x', `${x}px`);
    cardRef.current.style.setProperty('--mouse-y', `${y}px`);
  }, []);

  const handleWatch = useCallback(() => {
    triggerIris(`/player/${segment.id}`);
  }, [triggerIris, segment.id]);

  const handleWatchArea = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (reducedMotion) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distX = e.clientX - centerX;
    const distY = e.clientY - centerY;
    const dist = Math.sqrt(distX * distX + distY * distY);
    if (dist < 60) {
      mx.set(distX * 0.3);
      my.set(distY * 0.3);
    }
  }, [mx, my, reducedMotion]);

  const handleWatchLeave = useCallback(() => {
    mx.set(0);
    my.set(0);
  }, [mx, my]);

  const handleThumbnailClick = useCallback(
    (e: MouseEvent<HTMLDivElement>, i: number) => {
      e.stopPropagation();
      setLightboxIndex(i);
    },
    [],
  );

  const handleCloseLightbox = useCallback(() => {
    setLightboxIndex(-1);
  }, []);

  const isGenerating = segment.status === 'generating' || segment.status === 'pending';

  return (
    <>
      <motion.div
        ref={cardRef}
        initial={reducedMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        onMouseMove={handleMouseMove}
        className={`seg-card ${segment.status} agent-card archival-frame relative rounded-lg border border-[var(--bg4)] bg-[var(--bg2)] p-4 cursor-pointer`}
      >
        {/* Header row: mood badge + source count + index */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            {segment.mood ? (
              <Badge variant="gold">{segment.mood}</Badge>
            ) : (
              <span />
            )}
            {segment.sources?.length > 0 && (
              <Badge variant="muted">
                {segment.sources.length} src
              </Badge>
            )}
          </div>
          <span
            className="font-sans text-[10px] text-[var(--muted)] uppercase tracking-[0.15em]"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {String(index + 1).padStart(2, '0')}
          </span>
        </div>

        {/* Title with cipher reveal / skeleton shimmer */}
        <h3 className="seg-title font-serif text-[18px] font-normal text-[var(--text)] mb-3 leading-snug">
          {isGenerating
            ? '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'
            : scrambledTitle}
        </h3>

        {/* Hero image + thumbnail strip */}
        {segment.imageUrls?.length > 0 && (
          <div className="mb-3">
            {/* Hero: first image as a wide banner */}
            <div
              role="button"
              tabIndex={0}
              aria-label="View scene full size"
              className="w-full h-36 rounded-md bg-[var(--bg3)] overflow-hidden cursor-pointer transition-all duration-200 hover:brightness-110 active:scale-[0.99] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 mb-1.5"
              style={{ outlineColor: 'var(--gold)' }}
              onClick={(e) => handleThumbnailClick(e, 0)}
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  setLightboxIndex(0);
                }
              }}
            >
              <img
                src={segment.imageUrls[0]}
                alt={`${segment.title} — scene 1`}
                className="w-full h-full object-cover pointer-events-none"
                loading="lazy"
              />
            </div>
            {/* Secondary thumbnails */}
            {segment.imageUrls.length > 1 && (
              <div className="flex gap-1.5 overflow-hidden">
                {segment.imageUrls.slice(1, 4).map((url, i) => (
                  <div
                    key={i + 1}
                    role="button"
                    tabIndex={0}
                    aria-label={`View scene ${i + 2} full size`}
                    className="flex-1 h-14 rounded bg-[var(--bg3)] overflow-hidden cursor-pointer transition-opacity hover:opacity-80 active:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
                    style={{ outlineColor: 'var(--gold)' }}
                    onClick={(e) => handleThumbnailClick(e, i + 1)}
                    onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        setLightboxIndex(i + 1);
                      }
                    }}
                  >
                    <img
                      src={url}
                      alt={`Scene ${i + 2}`}
                      className="w-full h-full object-cover pointer-events-none"
                      loading="lazy"
                    />
                  </div>
                ))}
                {segment.imageUrls.length > 4 && (
                  <div
                    role="button"
                    tabIndex={0}
                    aria-label={`View ${segment.imageUrls.length - 4} more images`}
                    className="flex-1 h-14 rounded bg-[var(--bg3)] flex items-center justify-center cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
                    onClick={(e) => handleThumbnailClick(e, 4)}
                    onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        setLightboxIndex(4);
                      }
                    }}
                  >
                    <span className="font-sans text-[10px] text-[var(--muted)]">
                      +{segment.imageUrls.length - 4}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Script preview (2 lines) */}
        {segment.script && (
          <p className="font-sans text-[13px] text-[var(--muted)] line-clamp-2 mb-3 leading-relaxed">
            {segment.script}
          </p>
        )}

        {/* Watch button */}
        {isReady && (
          <div
            className="flex justify-end"
            onMouseMove={handleWatchArea}
            onMouseLeave={handleWatchLeave}
          >
            <motion.div style={reducedMotion ? {} : { x: springX, y: springY }}>
              <Button variant="secondary" size="sm" onClick={handleWatch}>
                {'\u25B6'} Watch
              </Button>
            </motion.div>
          </div>
        )}
      </motion.div>

      {/* Lightbox portal — rendered outside card DOM tree to avoid z-index stacking context issues */}
      {lightboxIndex >= 0 && (
        <Lightbox
          urls={segment.imageUrls}
          initialIndex={lightboxIndex}
          onClose={handleCloseLightbox}
        />
      )}
    </>
  );
});
