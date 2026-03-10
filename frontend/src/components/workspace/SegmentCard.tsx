import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import { motion, useMotionValue, useSpring, useReducedMotion } from 'motion/react';
import { Badge, Button } from '../ui';
import { usePlayerStore } from '../../store/playerStore';
import { useTextScramble } from '../../hooks/useTextScramble';
import type { Segment } from '../../types';

// ── Props ───────────────────────────────────────────────────────

interface SegmentCardProps {
  segment: Segment;
  index: number;
}

// ── Component ───────────────────────────────────────────────────

export function SegmentCard({ segment, index }: SegmentCardProps) {
  const triggerIris = usePlayerStore((s) => s.triggerIris);
  const reducedMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);

  // Magnetic pull motion values (must be unconditional)
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const springX = useSpring(mx, { stiffness: 150, damping: 15 });
  const springY = useSpring(my, { stiffness: 150, damping: 15 });
  const isReady = segment.status === 'ready' || segment.status === 'complete';
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

  const isGenerating = segment.status === 'generating' || segment.status === 'pending';

  return (
    <motion.div
      ref={cardRef}
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 22 }}
      onMouseMove={handleMouseMove}
      className={`seg-card ${segment.status} agent-card archival-frame relative rounded-lg border border-[var(--bg4)] bg-[var(--bg2)] p-4 cursor-pointer`}
    >
      {/* Header row: mood badge + index */}
      <div className="flex items-center justify-between mb-3">
        {segment.mood ? (
          <Badge variant="gold">{segment.mood}</Badge>
        ) : (
          <span />
        )}
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

      {/* Image thumbnails row */}
      {segment.imageUrls.length > 0 && (
        <div className="flex gap-1.5 mb-3 overflow-hidden">
          {segment.imageUrls.slice(0, 3).map((url, i) => (
            <div
              key={i}
              className="w-16 h-10 rounded bg-[var(--bg3)] overflow-hidden shrink-0"
            >
              <img
                src={url}
                alt={`Scene ${i + 1}`}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          ))}
          {segment.imageUrls.length > 3 && (
            <div className="w-16 h-10 rounded bg-[var(--bg3)] flex items-center justify-center shrink-0">
              <span className="font-sans text-[10px] text-[var(--muted)]">
                +{segment.imageUrls.length - 3}
              </span>
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
  );
}
