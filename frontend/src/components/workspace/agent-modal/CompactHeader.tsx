import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { AgentStatus } from '../../../types';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type Tab = 'sources' | 'facts' | 'log';

export interface CompactHeaderProps {
  query: string;
  status: AgentStatus;
  isLive: boolean;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  counts: { sources: number; facts: number; log: number };
}

// ─────────────────────────────────────────────────────────────
// useStickyDrawer hook
// ─────────────────────────────────────────────────────────────

export function useStickyDrawer(
  scrollContainerRef: React.RefObject<HTMLDivElement | null>,
) {
  const [isCompact, setIsCompact] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const obs = new IntersectionObserver(
      ([entry]) => setIsCompact(!entry.isIntersecting),
      { root: container, threshold: 0 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [scrollContainerRef]);

  return { isCompact, sentinelRef };
}

// ─────────────────────────────────────────────────────────────
// Status dot
// ─────────────────────────────────────────────────────────────

function StatusDot({ status, isLive }: { status: AgentStatus; isLive: boolean }) {
  const reducedMotion = useReducedMotion();

  const colorClass =
    isLive
      ? '[background:var(--teal)]'
      : status === 'done'
        ? '[background:var(--green)]'
        : status === 'error'
          ? 'bg-red-500'
          : '[background:var(--muted)]';

  return (
    <motion.div
      className={`w-2 h-2 rounded-full shrink-0 ${colorClass}`}
      animate={
        isLive && !reducedMotion
          ? { scale: [1, 1.45, 1], opacity: [1, 0.45, 1] }
          : {}
      }
      transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// Status badge (inline, no external Badge component dependency)
// ─────────────────────────────────────────────────────────────

const STATUS_BADGE_STYLES: Record<AgentStatus, string> = {
  searching:  'bg-[var(--teal)]/15  text-[var(--teal)]  border-[var(--teal)]/30',
  evaluating: 'bg-[var(--gold)]/15  text-[var(--gold)]  border-[var(--gold)]/30',
  done:       'bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/30',
  error:      'bg-red-500/10        text-red-400         border-red-500/25',
  queued:     'bg-[var(--muted)]/10 text-[var(--muted)] border-[var(--muted)]/20',
};

const STATUS_BADGE_LABELS: Record<AgentStatus, string> = {
  searching:  'Searching',
  evaluating: 'Evaluating',
  done:       'Done',
  error:      'Error',
  queued:     'Queued',
};

function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full font-sans text-[9px] uppercase tracking-[0.12em] border ${STATUS_BADGE_STYLES[status]}`}
    >
      {STATUS_BADGE_LABELS[status]}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Compact tab pills
// ─────────────────────────────────────────────────────────────

const TAB_DEFS: { id: Tab; label: string }[] = [
  { id: 'sources', label: 'Src' },
  { id: 'facts',   label: 'Fcts' },
  { id: 'log',     label: 'Log' },
];

function CompactTabPills({
  activeTab,
  onTabChange,
  counts,
}: {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  counts: { sources: number; facts: number; log: number };
}) {
  return (
    <div className="flex items-center gap-1">
      {TAB_DEFS.map(({ id, label }) => {
        const count = counts[id];
        const isActive = activeTab === id;

        return (
          <button
            key={id}
            onClick={() => onTabChange(id)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md font-sans text-[11px] transition-colors ${
              isActive
                ? 'bg-[var(--text)]/8 text-[var(--text)]'
                : 'text-[var(--muted)] hover:text-[var(--text)]/70'
            }`}
          >
            {label}
            {count > 0 && (
              <span
                className={`inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--text)] text-[var(--bg)]'
                    : 'bg-[var(--bg4)] text-[var(--muted)]'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// CompactHeader
// ─────────────────────────────────────────────────────────────

const QUERY_MAX_CHARS = 28;

function truncateQuery(query: string): string {
  if (query.length <= QUERY_MAX_CHARS) return query;
  return query.slice(0, QUERY_MAX_CHARS).trimEnd() + '\u2026';
}

export function CompactHeader({
  query,
  status,
  isLive,
  activeTab,
  onTabChange,
  counts,
}: CompactHeaderProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={
        reducedMotion
          ? { opacity: 0 }
          : { opacity: 0, y: -8 }
      }
      animate={
        reducedMotion
          ? { opacity: 1 }
          : { opacity: 1, y: 0 }
      }
      exit={
        reducedMotion
          ? { opacity: 0 }
          : { opacity: 0, y: -8 }
      }
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="sticky top-0 z-10 flex items-center gap-2.5 py-2.5 px-4 bg-[var(--bg2)]/95 backdrop-blur-md border-b border-[var(--bg4)]/40"
      style={{ minHeight: '44px' }}
    >
      {/* Left: dot + truncated query + status badge */}
      <StatusDot status={status} isLive={isLive} />

      <span
        className="font-serif text-[13px] text-[var(--text)] leading-none truncate min-w-0 flex-1"
        title={query}
      >
        {truncateQuery(query)}
      </span>

      <StatusBadge status={status} />

      {/* Right: tab pills */}
      <CompactTabPills
        activeTab={activeTab}
        onTabChange={onTabChange}
        counts={counts}
      />
    </motion.div>
  );
}
