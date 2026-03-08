import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Badge } from '../ui';
import { getAgentLogs } from '../../services/api';
import { typewriteEntry } from '../../hooks/useTypewriter';
import type { AgentState, AgentStatus, AgentLog, AgentLogsResponse, EvaluatedSource } from '../../types';

// ── Props ──────────────────────────────────────────────────────

interface AgentModalProps {
  agentId: string | null;
  agent: AgentState | null;
  sessionId: string;
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────

function statusBadgeVariant(status: AgentStatus): 'teal' | 'gold' | 'green' | 'red' | 'muted' {
  switch (status) {
    case 'searching':
      return 'teal';
    case 'evaluating':
      return 'gold';
    case 'done':
      return 'green';
    case 'error':
      return 'red';
    default:
      return 'muted';
  }
}

function stepGlyph(status: AgentStatus): string {
  switch (status) {
    case 'done':
      return '\u2713'; // checkmark
    case 'error':
      return '\u2717'; // ballot x
    default:
      return '\u25C6'; // diamond
  }
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

const logEntryVariants = {
  hidden: { opacity: 0, y: 12, filter: 'blur(3px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, stiffness: 280, damping: 22 },
  },
};

const sourceRowVariants = {
  hidden: { opacity: 0, x: -8 },
  show: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 300, damping: 24 },
  },
  exit: { opacity: 0, x: -4, transition: { duration: 0.15 } },
};

// ── Section Header ────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-serif text-[10px] uppercase tracking-[0.3em] text-[var(--gold)] mb-2">
      {children}
    </p>
  );
}

// ── Source Row ─────────────────────────────────────────────────

interface SourceRowProps {
  source: EvaluatedSource;
  isLive: boolean;
}

function SourceRow({ source, isLive }: SourceRowProps) {
  const label = source.title ?? extractHostname(source.url);

  return (
    <motion.div
      variants={isLive ? sourceRowVariants : undefined}
      initial={isLive ? 'hidden' : false}
      animate="show"
      exit="exit"
      layout
      className="grid items-center gap-3 py-1.5 border-b border-[var(--bg3)]/60 last:border-b-0"
      style={{ gridTemplateColumns: '12px 1fr auto 1fr' }}
    >
      {/* Diamond glyph */}
      <span className="text-[var(--gold)] text-[10px] leading-none">{'\u25C6'}</span>

      {/* Source label */}
      <span
        className="font-sans text-[13px] text-[var(--text)] truncate"
        title={source.url}
      >
        {label}
      </span>

      {/* Acceptance badge */}
      {source.accepted ? (
        <span className="inline-flex items-center gap-1 font-sans text-[10px] uppercase tracking-[0.15em] text-[var(--green)] shrink-0">
          <span>{'\u2713'}</span>
          <span>Accepted</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 font-sans text-[10px] uppercase tracking-[0.15em] text-red-500 shrink-0">
          <span>{'\u2717'}</span>
          <span>Rejected</span>
        </span>
      )}

      {/* Reason */}
      <span className="font-sans text-[11px] text-[var(--muted)] truncate">
        {source.reason}
      </span>
    </motion.div>
  );
}

// ── Shimmer Skeleton Row ──────────────────────────────────────

function ShimmerRow({ width }: { width: string }) {
  return (
    <div
      className="grid items-center gap-3 py-1.5"
      style={{ gridTemplateColumns: '12px 1fr auto 1fr' }}
    >
      <span className="text-[var(--bg4)] text-[10px] leading-none">{'\u25C6'}</span>
      <div className={`log-source evaluating h-3.5 rounded ${width}`} />
      <div className="log-source evaluating h-3 rounded w-16" />
      <div className="log-source evaluating h-3 rounded w-24" />
    </div>
  );
}

// ── Typewriter Log Entry ───────────────────────────────────────

interface TypewriterLogProps {
  log: AgentLog;
  shouldAnimate: boolean;
}

function TypewriterLogEntry({ log, shouldAnimate }: TypewriterLogProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const animatedRef = useRef(false);

  useEffect(() => {
    if (shouldAnimate && textRef.current && !animatedRef.current) {
      animatedRef.current = true;
      typewriteEntry(textRef.current, log.step, 20);
    }
  }, [shouldAnimate, log.step]);

  return (
    <motion.li
      variants={logEntryVariants}
      className="flex gap-3 items-start font-sans text-[13px] text-[var(--text)]"
    >
      <span className="text-[var(--gold)] text-xs mt-0.5 shrink-0">
        {stepGlyph('queued')}
      </span>
      <span ref={textRef} className="flex-1">
        {shouldAnimate ? '' : log.step}
      </span>
      <span className="text-[10px] text-[var(--muted)] shrink-0" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {log.ts}
      </span>
    </motion.li>
  );
}

// ── Component ──────────────────────────────────────────────────

export function AgentModal({ agentId, agent, sessionId, onClose }: AgentModalProps) {
  // Fetch full logs from API when the agent is done (replay mode)
  const { data: logsData } = useQuery<AgentLogsResponse>({
    queryKey: ['agentLogs', sessionId, agentId],
    queryFn: () => getAgentLogs(sessionId, agentId!),
    enabled: !!agentId && agent?.status === 'done',
    staleTime: Infinity,
  });

  const logs: AgentLog[] = logsData?.logs ?? agent?.logs ?? [];
  const isLive = agent?.status === 'searching' || agent?.status === 'evaluating';
  const evaluatedSources = agent?.evaluatedSources ?? [];
  const hasSources = evaluatedSources.length > 0;

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <Modal
      open={!!agentId}
      onOpenChange={(open) => { if (!open) handleClose(); }}
      title={agent?.query ?? 'Agent Details'}
      description={`Status: ${agent?.status ?? 'unknown'} \u00B7 ${agent?.elapsed ?? 0}s elapsed`}
      className="w-[680px]"
    >
      <div className="px-6 pb-6 space-y-5">
        {/* Status badge + elapsed */}
        <div className="flex items-center gap-2">
          <Badge variant={statusBadgeVariant(agent?.status ?? 'queued')}>
            {agent?.status ?? 'queued'}
          </Badge>
          <span
            className="font-sans text-[10px] text-[var(--muted)]"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {agent?.elapsed ?? 0}s
          </span>
        </div>

        {/* ── Section 1: Sources Dispatched ──────────────────────── */}
        {hasSources && (
          <div>
            <SectionHeader>Sources Dispatched</SectionHeader>
            <div
              className="rounded-lg border border-[var(--bg4)]/60 bg-[var(--bg)]/50 px-3 py-2"
            >
              <AnimatePresence initial={false}>
                {evaluatedSources.map((source, i) => (
                  <SourceRow
                    key={source.url + String(i)}
                    source={source}
                    isLive={isLive}
                  />
                ))}
              </AnimatePresence>

              {/* Shimmer skeletons while evaluating */}
              {agent?.status === 'evaluating' && (
                <>
                  <ShimmerRow width="w-3/4" />
                  <ShimmerRow width="w-1/2" />
                </>
              )}
            </div>
          </div>
        )}

        {/* Evaluating shimmer when no sources yet */}
        {!hasSources && agent?.status === 'evaluating' && (
          <div>
            <SectionHeader>Sources Dispatched</SectionHeader>
            <div className="rounded-lg border border-[var(--bg4)]/60 bg-[var(--bg)]/50 px-3 py-2 space-y-1">
              <ShimmerRow width="w-3/4" />
              <ShimmerRow width="w-1/2" />
            </div>
          </div>
        )}

        {/* ── Section 2: Field Log ───────────────────────────────── */}
        {logs.length > 0 && (
          <div>
            <SectionHeader>Field Log</SectionHeader>
            <motion.ul
              className="space-y-2 max-h-40 overflow-y-auto pr-1"
              style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--bg4) transparent' }}
              variants={{ show: { transition: { staggerChildren: 0.08 } } }}
              initial="hidden"
              animate="show"
            >
              <AnimatePresence>
                {logs.map((log, i) => (
                  <TypewriterLogEntry
                    key={`${log.ts}-${i}`}
                    log={log}
                    shouldAnimate={isLive}
                  />
                ))}
              </AnimatePresence>
            </motion.ul>
          </div>
        )}

        {/* ── Section 3: Visual Prompt ───────────────────────────── */}
        {agent?.visualResearchPrompt && (
          <div>
            <SectionHeader>Visual Prompt</SectionHeader>
            <div className="rounded-lg border border-[var(--bg4)]/60 bg-[var(--bg)]/50 px-4 py-3">
              <p className="font-serif text-[14px] italic text-[var(--text)]/80 leading-relaxed">
                {agent.visualResearchPrompt}
              </p>
            </div>
          </div>
        )}

        {/* ── Verified Facts ─────────────────────────────────────── */}
        {agent?.facts && agent.facts.length > 0 && (
          <div>
            <SectionHeader>Verified Facts</SectionHeader>
            <ul className="space-y-1.5">
              {agent.facts.map((fact, i) => (
                <li key={i} className="flex gap-2 font-sans text-[13px] text-[var(--text)]">
                  <span className="text-[var(--green)] shrink-0">{'\u2713'}</span>
                  {fact}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
