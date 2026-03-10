import { useReducedMotion } from 'motion/react';
import { motion } from 'motion/react';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function shortenQuery(query: string): string {
  if (query.length <= 40) return query;
  return query.slice(0, 37) + '...';
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}

// ─────────────────────────────────────────────────────────────
// KeyFindingBanner
// ─────────────────────────────────────────────────────────────

export interface KeyFindingBannerProps {
  query: string;
  acceptedCount: number;
  rejectedCount: number;
  visualResearchPrompt?: string;
}

export function KeyFindingBanner({
  query,
  acceptedCount,
  rejectedCount,
  visualResearchPrompt,
}: KeyFindingBannerProps) {
  const reducedMotion = useReducedMotion();

  const sourcePlural = acceptedCount === 1 ? 'source' : 'sources';
  const line1 =
    `${acceptedCount} ${sourcePlural} confirmed ${shortenQuery(query)}.` +
    (rejectedCount > 0
      ? ` Rejected ${rejectedCount} for low historical specificity.`
      : '');

  const line2 = visualResearchPrompt
    ? `Visual focus: ${truncate(visualResearchPrompt, 90)}.`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      className="border border-[var(--gold)]/25 bg-[var(--gold)]/5 rounded-xl px-4 py-3"
    >
      {/* Header label */}
      <p
        className="font-serif text-[9px] uppercase tracking-[0.35em] text-[var(--gold)] mb-1.5"
        style={{ fontFamily: "'Cormorant Garamond', serif" }}
      >
        Key Finding
      </p>

      {/* Primary finding line */}
      <p
        className="font-serif text-[13px] italic text-[var(--text)]/80 leading-relaxed"
        style={{ fontFamily: "'Cormorant Garamond', serif" }}
      >
        <span className="text-[var(--gold)] mr-1.5 not-italic">◈</span>
        {line1}
      </p>

      {/* Visual focus line — shown only when visualResearchPrompt exists */}
      {line2 !== null && (
        <p
          className="font-serif text-[11px] text-[var(--muted)] mt-1"
          style={{ fontFamily: "'Cormorant Garamond', serif" }}
        >
          {line2}
        </p>
      )}
    </motion.div>
  );
}
