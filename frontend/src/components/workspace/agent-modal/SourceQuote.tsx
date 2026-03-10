import { useReducedMotion } from 'motion/react';
import { motion } from 'motion/react';

// ─────────────────────────────────────────────────────────────
// SourceQuote
// Replaces the plain reason <p> in SourceCard with a styled
// pull-quote blockquote — gold left border, italic serif, curly quotes.
// ─────────────────────────────────────────────────────────────

export interface SourceQuoteProps {
  text: string;
  hero?: boolean;  // true = hero card variant (larger text, more lines)
  index?: number;  // for staggered animation delay
}

export function SourceQuote({ text, hero = false, index = 0 }: SourceQuoteProps) {
  const reducedMotion = useReducedMotion();

  if (!text) return null;

  return (
    <motion.blockquote
      className="border-l-2 border-[var(--gold)]/50 pl-3 my-2"
      initial={{ opacity: reducedMotion ? 1 : 0 }}
      animate={{ opacity: 1 }}
      transition={
        reducedMotion
          ? undefined
          : { delay: 0.1 + index * 0.03, duration: 0.25 }
      }
    >
      <p
        className={`font-serif italic leading-relaxed text-[var(--text)]/65 ${
          hero ? 'text-[13px] line-clamp-4' : 'text-[11px] line-clamp-3'
        }`}
      >
        {'\u201C'}{text}{'\u201D'}
      </p>
    </motion.blockquote>
  );
}

// ─────────────────────────────────────────────────────────────
// VisualPromptQuote
// Replaces the visual prompt blockquote in FactsTab.
// Renders a gold-labeled container with the same italic serif style.
// ─────────────────────────────────────────────────────────────

export interface VisualPromptQuoteProps {
  prompt: string;
}

export function VisualPromptQuote({ prompt }: VisualPromptQuoteProps) {
  if (!prompt) return null;

  return (
    <div className="rounded-xl border border-[var(--gold)]/20 bg-[var(--gold)]/5 px-4 py-3">
      <p className="font-serif text-[9px] uppercase tracking-[0.3em] text-[var(--gold)] mb-1.5">
        Visual Prompt
      </p>
      <p className="font-serif text-[13px] italic text-[var(--text)]/75 leading-relaxed">
        {'\u201C'}{prompt}{'\u201D'}
      </p>
    </div>
  );
}
