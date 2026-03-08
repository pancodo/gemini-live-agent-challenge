import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button } from '../ui';
import type { Segment } from '../../types';

// ── Cipher Scramble Hook ────────────────────────────────────────

const CIPHER_CHARS = '\u0391\u0392\u0393\u0394\u0395\u0396\u0397\u0398\u0399\u039A\u039B\u039C\u039D\u039E\u039F\u03A0\u03A1\u03A3\u03A4\u03A5\u03A6\u03A7\u03A8\u03A9\u03B1\u03B2\u03B3\u03B4\u03B5\u03B6\u03B7\u03B8';

function useTextScramble(finalText: string, active: boolean): string {
  const [display, setDisplay] = useState(finalText);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (!active || !finalText) {
      setDisplay(finalText);
      return;
    }

    const duration = 600; // ms
    startRef.current = performance.now();

    function step(now: number): void {
      const elapsed = now - startRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const resolvedCount = Math.floor(progress * finalText.length);

      let result = '';
      for (let i = 0; i < finalText.length; i++) {
        if (i < resolvedCount) {
          result += finalText[i];
        } else if (finalText[i] === ' ') {
          result += ' ';
        } else {
          result += CIPHER_CHARS[Math.floor(Math.random() * CIPHER_CHARS.length)];
        }
      }

      setDisplay(result);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(finalText);
      }
    }

    rafRef.current = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(rafRef.current);
    };
  }, [finalText, active]);

  return display;
}

// ── Props ───────────────────────────────────────────────────────

interface SegmentCardProps {
  segment: Segment;
  index: number;
}

// ── Component ───────────────────────────────────────────────────

export function SegmentCard({ segment, index }: SegmentCardProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const [hasBeenReady, setHasBeenReady] = useState(segment.status === 'ready');

  // Track transition to ready for cipher reveal
  useEffect(() => {
    if (segment.status === 'ready' && !hasBeenReady) {
      setHasBeenReady(true);
    }
  }, [segment.status, hasBeenReady]);

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
    navigate(`/player/${segment.id}`);
  }, [navigate, segment.id]);

  const isGenerating = segment.status === 'generating';

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
      {segment.status === 'ready' && (
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={handleWatch}>
            {'\u25B6'} Watch
          </Button>
        </div>
      )}
    </motion.div>
  );
}
