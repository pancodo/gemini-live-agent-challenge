import { useCallback, useEffect, useRef } from 'react';
import { motion, useReducedMotion, type Variants } from 'motion/react';
import { useResearchStore, type PhaseEntry } from '../../store/researchStore';
import { typewriteEntry } from '../../hooks/useTypewriter';

// ── Phase number → Roman numeral ────────────────────────
const ROMAN: Record<1 | 2 | 3 | 4, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
};

// ── Motion Variants ─────────────────────────────────────
const listVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08 },
  },
};

const entryVariants: Variants = {
  hidden: { opacity: 0, y: 12, filter: 'blur(3px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring', stiffness: 280, damping: 22 },
  },
};

const staticTransition = { duration: 0 };

// ── StatBadge ───────────────────────────────────────────
function StatBadge({ label, value }: { label: string; value: number }) {
  const prevRef = useRef(value);
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (value !== prevRef.current && spanRef.current) {
      spanRef.current.classList.remove('updated');
      // Force reflow so re-adding the class triggers the animation
      void spanRef.current.offsetWidth;
      spanRef.current.classList.add('updated');
      prevRef.current = value;
    }
  }, [value]);

  return (
    <div className="flex items-center gap-1.5">
      <span
        className="text-[10px] font-sans uppercase tracking-[0.15em] text-[var(--muted)]"
      >
        {label}
      </span>
      <span
        ref={spanRef}
        className="stat-value text-[13px] font-sans font-medium text-[var(--gold)] tabular-nums"
      >
        {value}
      </span>
    </div>
  );
}

// ── PhaseBlock ──────────────────────────────────────────
function PhaseBlock({
  entry,
  reduced,
  typewrittenRef,
}: {
  entry: PhaseEntry;
  reduced: boolean;
  typewrittenRef: React.RefObject<Set<string>>;
}) {
  const messageCallbackRef = useCallback(
    (node: HTMLSpanElement | null, key: string, text: string) => {
      if (!node) return;
      if (typewrittenRef.current.has(key)) return;
      typewrittenRef.current.add(key);
      if (reduced) {
        node.textContent = text;
      } else {
        typewriteEntry(node, text);
      }
    },
    [reduced, typewrittenRef],
  );

  return (
    <motion.div
      variants={reduced ? undefined : listVariants}
      initial="hidden"
      animate="show"
      transition={reduced ? staticTransition : undefined}
    >
      {/* Phase header */}
      <p
        className="text-[11px] font-serif uppercase tracking-[0.35em] text-[var(--gold)] mb-0"
        style={{ fontWeight: 400 }}
      >
        Phase {ROMAN[entry.phase]} — {entry.label}
      </p>

      {/* Self-drawing divider */}
      <div className="phase-divider">
        <div className="phase-divider-dot" />
      </div>

      {/* Messages */}
      {entry.messages.map((msg, idx) => {
        const key = `${entry.phase}-${idx}`;
        return (
          <motion.div
            key={key}
            className="flex items-start gap-2 mb-1.5"
            variants={reduced ? undefined : entryVariants}
            transition={reduced ? staticTransition : undefined}
          >
            <span className="mt-[5px] inline-block w-[5px] h-[5px] rounded-full bg-[var(--gold)] shrink-0" />
            <span
              ref={(node) => messageCallbackRef(node, key, msg)}
              className="text-[13px] font-sans text-[var(--text)] leading-relaxed"
            />
          </motion.div>
        );
      })}
    </motion.div>
  );
}

// ── ExpeditionLog ───────────────────────────────────────
export function ExpeditionLog() {
  const phases = useResearchStore((s) => s.phases);
  const stats = useResearchStore((s) => s.stats);
  const reduced = useReducedMotion() ?? false;

  // Track which message keys have already been typewritten
  const typewrittenRef = useRef<Set<string>>(new Set());

  // Auto-scroll container
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [phases]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <h2
          className="text-[11px] font-serif uppercase tracking-[0.4em] text-[var(--gold)]"
          style={{ fontWeight: 400 }}
        >
          Expedition Log
        </h2>
      </div>

      {/* Scrollable log area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 pb-4 space-y-5"
        aria-busy={phases.length === 0}
        aria-live="polite"
      >
        {phases.length === 0 && (
          <p className="text-[12px] font-sans text-[var(--muted)] italic">
            Awaiting field dispatches...
          </p>
        )}

        {phases.map((entry) => (
          <PhaseBlock
            key={entry.phase}
            entry={entry}
            reduced={reduced}
            typewrittenRef={typewrittenRef}
          />
        ))}
      </div>

      {/* Stats bar */}
      <div className="stats-bar flex items-center gap-4 px-5 py-3 border-t border-[var(--bg4)]">
        <StatBadge label="SOURCES FOUND" value={stats.sourcesFound} />
        <span className="text-[var(--bg4)]">&middot;</span>
        <StatBadge label="FACTS VERIFIED" value={stats.factsVerified} />
        <span className="text-[var(--bg4)]">&middot;</span>
        <StatBadge label="SEGMENTS READY" value={stats.segmentsReady} />
      </div>
    </div>
  );
}
