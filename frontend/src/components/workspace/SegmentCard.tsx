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
import { Button } from '../ui';
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
  const [scriptExpanded, setScriptExpanded] = useState(false);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const imageCount = segment.imageUrls?.length ?? 0;

  // Auto-cycle images every 4s
  useEffect(() => {
    if (imageCount <= 1) return;
    const timer = setInterval(() => {
      setCarouselIdx((prev) => (prev + 1) % imageCount);
    }, 4000);
    return () => clearInterval(timer);
  }, [imageCount]);

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
        className={`seg-card ${segment.status} agent-card archival-frame relative rounded-lg border border-[var(--bg4)] bg-[var(--bg)] p-4 cursor-pointer`}
      >
        {/* Title row with index */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="seg-title font-serif text-[20px] font-normal text-[var(--text)] leading-snug flex-1">
            {isGenerating
              ? <span className="inline-block w-3/4 h-[1.2em] rounded bg-[var(--bg3)] animate-pulse" />
              : scrambledTitle}
          </h3>
          <span
            className="font-serif text-[12px] text-[var(--gold)] tracking-[0.1em] shrink-0 mt-1"
            style={{ opacity: 0.5 }}
          >
            {['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][index] ?? String(index + 1)}
          </span>
        </div>

        {/* Image carousel — single image with crossfade + dot navigation */}
        {imageCount > 0 && (
          <div className="relative mb-3">
            <div
              role="button"
              tabIndex={0}
              aria-label={`View scene ${carouselIdx + 1} of ${imageCount} full size`}
              className="w-full aspect-[16/9] rounded-md bg-[var(--bg3)] overflow-hidden cursor-pointer relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1"
              style={{ outlineColor: 'var(--gold)' }}
              onClick={(e) => handleThumbnailClick(e, carouselIdx)}
              onKeyDown={(e: KeyboardEvent<HTMLDivElement>) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  setLightboxIndex(carouselIdx);
                }
              }}
            >
              {segment.imageUrls.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`${segment.title} — scene ${i + 1}`}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                  loading="lazy"
                  style={{
                    opacity: i === carouselIdx ? 1 : 0,
                    transition: 'opacity 0.8s ease-in-out',
                  }}
                />
              ))}
              {/* Frame counter */}
              <span
                className="absolute top-2 right-2 font-sans text-[9px] uppercase tracking-[0.15em] px-2 py-0.5 rounded"
                style={{
                  background: 'rgba(0,0,0,0.5)',
                  color: 'rgba(255,255,255,0.8)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                {carouselIdx + 1} / {imageCount}
              </span>
            </div>
            {/* Dot indicators */}
            {imageCount > 1 && (
              <div className="flex justify-center gap-1.5 mt-2">
                {segment.imageUrls.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`Go to scene ${i + 1}`}
                    className="p-0 border-none bg-transparent cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); setCarouselIdx(i); }}
                  >
                    <span
                      className="block rounded-full transition-all duration-300"
                      style={{
                        width: i === carouselIdx ? 16 : 6,
                        height: 6,
                        background: i === carouselIdx ? 'var(--gold)' : 'var(--bg4)',
                      }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Script preview — expandable */}
        {segment.script && (
          <div className="mb-3">
            <p
              className={`font-sans text-[13.5px] text-[var(--text)] leading-relaxed opacity-70 drop-cap ${scriptExpanded ? '' : 'line-clamp-3'}`}
            >
              {segment.script}
            </p>
            {segment.script.length > 200 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setScriptExpanded((v) => !v); }}
                className="font-sans text-[11px] text-[var(--gold)] mt-1 cursor-pointer bg-transparent border-none p-0 hover:underline"
              >
                {scriptExpanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        )}

        {/* Watch button */}
        {isReady && (
          <div
            className="flex justify-end"
            onMouseMove={handleWatchArea}
            onMouseLeave={handleWatchLeave}
          >
            <motion.div style={reducedMotion ? {} : { x: springX, y: springY }}>
              <Button variant="primary" size="sm" onClick={handleWatch}>
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
