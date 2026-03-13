import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react';
import { useResearchStore, type PhaseEntry } from '../../store/researchStore';
import { useSessionStore } from '../../store/sessionStore';
import { typewriteEntry } from '../../hooks/useTypewriter';
import { AgentModal } from './AgentModal';
import type { AgentState, AgentStatus } from '../../types';

// ── Phase number → Roman numeral ────────────────────────
const ROMAN: Record<number, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  3.8: 'III.VIII',
  4: 'IV',
  5: 'V',
  6: 'VI',
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

const agentRowVariants: Variants = {
  hidden: { opacity: 0, x: -6 },
  show: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 320, damping: 24 },
  },
};

const staticTransition = { duration: 0 };

// ── Agent phase membership ───────────────────────────────
// Returns true if agentId belongs to the given 1-indexed pipeline phase.
function agentBelongsToPhase(phase: number, agentId: string): boolean {
  const id = agentId.toLowerCase();
  switch (phase) {
    case 1: return id.startsWith('scan') || id.startsWith('document');
    case 2: return id.startsWith('research') || id.startsWith('scene');
    case 3: return id.startsWith('aggregat') || id.startsWith('script');
    case 3.8: return id.startsWith('geo');
    case 4: return id.startsWith('visual');
    default: return false;
  }
}

// ── Status dot ──────────────────────────────────────────
function StatusDot({ status }: { status: AgentStatus }) {
  const base = 'w-1.5 h-1.5 rounded-full shrink-0';
  switch (status) {
    case 'queued':     return <span className={`${base} border border-[var(--muted)]`} />;
    case 'searching':  return <span className={`${base} bg-[var(--teal)]`} />;
    case 'evaluating': return <span className={`${base} bg-[var(--gold)]`} />;
    case 'done':       return <span className={`${base} bg-[var(--green)]`} />;
    case 'error':      return <span className={`${base} bg-red-500`} />;
  }
}

// ── Clickable agent row ──────────────────────────────────
interface LogAgentRowProps {
  agent: AgentState;
  onClick: () => void;
  reduced: boolean;
}

function LogAgentRow({ agent, onClick, reduced }: LogAgentRowProps) {
  return (
    <motion.button
      variants={reduced ? undefined : agentRowVariants}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg3)] transition-colors text-left group"
      aria-label={`View details for ${agent.query}`}
    >
      <StatusDot status={agent.status} />
      <span className="flex-1 font-sans text-[12px] text-[var(--text)] truncate group-hover:text-[var(--gold)] transition-colors">
        {agent.query ?? agent.id}
      </span>
      {agent.elapsed !== undefined && agent.elapsed > 0 && (
        <span
          className="font-sans text-[10px] text-[var(--muted)] shrink-0"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {agent.elapsed}s
        </span>
      )}
      <span className="font-sans text-[9px] text-[var(--muted)] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        ↗
      </span>
    </motion.button>
  );
}

// ── StatBadge ───────────────────────────────────────────
function StatBadge({ label, value }: { label: string; value: number }) {
  const prevRef = useRef(value);
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (value !== prevRef.current && spanRef.current) {
      spanRef.current.classList.remove('updated');
      void spanRef.current.offsetWidth;
      spanRef.current.classList.add('updated');
      prevRef.current = value;
    }
  }, [value]);

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-sans uppercase tracking-[0.15em] text-[var(--muted)]">
        {label}
      </span>
      <span
        ref={spanRef}
        className="stat-value text-[16px] font-sans font-medium text-[var(--gold)] tabular-nums"
      >
        {value}
      </span>
    </div>
  );
}

// ── PhaseBlock ──────────────────────────────────────────
interface PhaseBlockProps {
  entry: PhaseEntry;
  isActive: boolean;
  reduced: boolean;
  typewrittenRef: React.RefObject<Set<string>>;
  phaseAgents: AgentState[];
  onAgentClick: (id: string) => void;
}

function PhaseBlock({
  entry,
  isActive,
  reduced,
  typewrittenRef,
  phaseAgents,
  onAgentClick,
}: PhaseBlockProps) {
  const [collapsed, setCollapsed] = useState(false);
  // Track whether the user manually toggled this phase open/closed.
  // When true, auto-collapse is suppressed so the user can read at their pace.
  const userToggledRef = useRef(false);

  // Auto-collapse completed phases after 2 seconds — unless user manually opened it
  useEffect(() => {
    if (userToggledRef.current) return;
    if (!isActive) {
      const allDone = phaseAgents.length > 0 && phaseAgents.every(
        (a) => a.status === 'done' || a.status === 'error',
      );
      if (allDone) {
        const t = setTimeout(() => setCollapsed(true), 2000);
        return () => clearTimeout(t);
      }
    }
  }, [isActive, phaseAgents]);

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

  const headerLabel = entry.phase in ROMAN
    ? `Phase ${ROMAN[entry.phase]} — ${entry.label}`
    : `Phase — ${entry.label}`;

  return (
    <motion.div
      variants={reduced ? undefined : listVariants}
      initial="hidden"
      animate="show"
      transition={reduced ? staticTransition : undefined}
    >
      {/* Phase header — clickable to toggle collapse */}
      <button
        type="button"
        onClick={() => { userToggledRef.current = true; setCollapsed((c) => !c); }}
        className="w-full flex items-center gap-2 text-left cursor-pointer bg-transparent border-none p-0 mb-0"
        aria-expanded={!collapsed}
      >
        <p
          className="text-[12px] font-serif uppercase tracking-[0.3em] text-[var(--gold)] mb-0 flex-1"
          style={{ fontWeight: 700 }}
        >
          {headerLabel}
        </p>
        <span className="text-[9px] text-[var(--muted)] opacity-40 shrink-0 select-none">
          {collapsed ? '\u25B6' : '\u25BC'}
        </span>
      </button>

      {/* Self-drawing divider */}
      <div className="phase-divider">
        <div className="phase-divider-dot" />
      </div>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key={`phase-content-${entry.phase}`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
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

            {/* Agent rows — clickable for detail */}
            {phaseAgents.length > 0 && (
              <motion.div
                className="mt-2 space-y-0.5"
                variants={reduced ? undefined : listVariants}
                initial="hidden"
                animate="show"
              >
                {phaseAgents.map((agent) => (
                  <LogAgentRow
                    key={agent.id}
                    agent={agent}
                    onClick={() => onAgentClick(agent.id)}
                    reduced={reduced}
                  />
                ))}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── ExpeditionLog ───────────────────────────────────────
export function ExpeditionLog() {
  const phases = useResearchStore((s) => s.phases);
  const sourcesFound = useResearchStore((s) => s.stats.sourcesFound);
  const factsVerified = useResearchStore((s) => s.stats.factsVerified);
  const segmentsReady = useResearchStore((s) => s.stats.segmentsReady);
  const agents = useResearchStore((s) => s.agents);
  const sessionId = useSessionStore((s) => s.sessionId);
  const reduced = useReducedMotion() ?? false;

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const typewrittenRef = useRef<Set<string>>(new Set());

  // Auto-scroll container
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [phases, agents]);

  const agentList = useMemo(() => Object.values(agents), [agents]);
  const activeAgentCount = useMemo(() => agentList.filter((a) => a.status === 'searching').length, [agentList]);
  const searchingCount = activeAgentCount;
  const selectedAgent = selectedAgentId ? (agents[selectedAgentId] ?? null) : null;

  // The active phase is the last phase in the list (most recently started)
  const activePhaseNumber = phases.length > 0 ? phases[phases.length - 1].phase : null;

  const agentsByPhase = useMemo(() => {
    const map = new Map<number, AgentState[]>();
    const phaseKeys = [1, 2, 3, 3.8, 4, 5, 6];
    for (const agent of agentList) {
      for (const p of phaseKeys) {
        if (agentBelongsToPhase(p, agent.id)) {
          const arr = map.get(p) ?? [];
          arr.push(agent);
          map.set(p, arr);
          break;
        }
      }
    }
    return map;
  }, [agentList]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <h2
          className="text-[12px] font-serif uppercase tracking-[0.35em] text-[var(--gold)]"
          style={{ fontWeight: 700 }}
        >
          Expedition Log
        </h2>
        {searchingCount > 0 && (
          <motion.span
            key={searchingCount}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 10,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              display: 'block',
              marginTop: 4,
            }}
          >
            {searchingCount} agent{searchingCount !== 1 ? 's' : ''} working
          </motion.span>
        )}
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
            isActive={entry.phase === activePhaseNumber}
            reduced={reduced}
            typewrittenRef={typewrittenRef}
            phaseAgents={agentsByPhase.get(entry.phase) ?? []}
            onAgentClick={setSelectedAgentId}
          />
        ))}
      </div>

      {/* Stats bar */}
      <div className="stats-bar flex items-center justify-center gap-6 px-5 py-3 border-t border-[var(--bg4)]" style={{ boxShadow: '0 -4px 12px rgba(0,0,0,0.04)' }}>
        <StatBadge label="SOURCES FOUND" value={sourcesFound} />
        <span className="text-[var(--bg4)]">&middot;</span>
        <StatBadge label="FACTS VERIFIED" value={factsVerified} />
        <span className="text-[var(--bg4)]">&middot;</span>
        <StatBadge label="SEGMENTS READY" value={segmentsReady} />
      </div>

      {/* Agent detail modal */}
      {sessionId && (
        <AgentModal
          agentId={selectedAgentId}
          agent={selectedAgent}
          sessionId={sessionId}
          onClose={() => setSelectedAgentId(null)}
        />
      )}
    </div>
  );
}
