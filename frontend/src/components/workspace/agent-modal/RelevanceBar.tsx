import { useEffect } from 'react';
import { motion, useSpring, useTransform, useReducedMotion } from 'motion/react';
import type { EvaluatedSource } from '../../../types';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface RelevanceBarProps {
  score: number;      // 0–100
  compact?: boolean;  // true = 2px height (normal cards), false = 3px (hero)
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Derive a stable pseudo-score from a URL string.
 * Uses a simple hash so the same URL always produces the same value.
 * accepted  → 60–95 range
 * rejected  → 15–50 range
 */
function hashUrl(url: string): number {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash | 0; // convert to 32-bit integer
  }
  return Math.abs(hash);
}

export function deriveRelevanceScore(source: EvaluatedSource): number {
  if (source.relevanceScore !== undefined) {
    return Math.max(0, Math.min(100, source.relevanceScore));
  }

  const h = hashUrl(source.url);

  if (source.accepted) {
    // accepted: 60–95
    return 60 + (h % 36);
  } else {
    // rejected: 15–50
    return 15 + (h % 36);
  }
}

function fillColor(score: number): string {
  if (score >= 75) return 'var(--green)';
  if (score >= 50) return 'var(--gold)';
  return 'var(--muted)';
}

// ─────────────────────────────────────────────────────────────
// RelevanceBar
// ─────────────────────────────────────────────────────────────

export function RelevanceBar({ score, compact = true }: RelevanceBarProps) {
  const reducedMotion = useReducedMotion();

  const spring = useSpring(0, { stiffness: 120, damping: 20, mass: 0.8 });

  const widthValue = useTransform(spring, (v: number) => `${v}%`);
  const labelValue = useTransform(spring, (v: number) => `${Math.round(v)}%`);

  useEffect(() => {
    if (reducedMotion) {
      // Skip spring — jump directly to score value
      spring.jump(score);
    } else {
      spring.set(score);
    }
  }, [score, spring, reducedMotion]);

  const trackHeight = compact ? 'h-[2px]' : 'h-[3px]';
  const color = fillColor(score);

  return (
    <div className="flex items-center gap-2">
      {/* Track */}
      <div
        className={`flex-1 ${trackHeight} rounded-full overflow-hidden`}
        style={{ backgroundColor: 'color-mix(in srgb, var(--bg4) 40%, transparent)' }}
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Relevance score: ${score}%`}
      >
        {/* Fill */}
        <motion.div
          className={`h-full rounded-full`}
          style={{
            width: widthValue,
            backgroundColor: color,
          }}
        />
      </div>

      {/* Percentage label */}
      <motion.span
        className="font-sans text-[10px] tabular-nums text-[var(--muted)] shrink-0 w-7 text-right"
        style={{ display: 'inline-block' }}
      >
        {labelValue}
      </motion.span>
    </div>
  );
}
