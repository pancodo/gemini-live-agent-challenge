import { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Badge } from '../ui';
import { getAgentLogs } from '../../services/api';
import { typewriteEntry } from '../../hooks/useTypewriter';
import type { AgentState, AgentStatus, AgentLog, AgentLogsResponse } from '../../types';

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

const logEntryVariants = {
  hidden: { opacity: 0, y: 12, filter: 'blur(3px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { type: 'spring' as const, stiffness: 280, damping: 22 },
  },
};

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
      <div className="px-6 pb-6 space-y-4">
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

        {/* Log entries */}
        <motion.ul
          className="space-y-2 max-h-64 overflow-y-auto"
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

        {/* Unresolved source shimmer (evaluating state) */}
        {agent?.status === 'evaluating' && (
          <div className="space-y-2">
            <div className="log-source evaluating h-4 rounded w-3/4" />
            <div className="log-source evaluating h-4 rounded w-1/2" />
          </div>
        )}

        {/* Verified Facts */}
        {agent?.facts && agent.facts.length > 0 && (
          <div>
            <p className="font-serif text-[10px] uppercase tracking-[0.3em] text-[var(--gold)] mb-2">
              Verified Facts
            </p>
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
