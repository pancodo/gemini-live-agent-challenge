import { useState, useEffect, useRef, useCallback, type MouseEvent } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { useResearchStore } from '../../store/researchStore';
import { useSessionStore } from '../../store/sessionStore';
import { HistorianPanel } from './HistorianPanel';
import { AgentModal } from './AgentModal';
import { SegmentCard } from './SegmentCard';
import type { AgentState, AgentStatus } from '../../types';

// ── Helpers ─────────────────────────────────────────────────────

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function faviconUrl(url: string): string {
  return `https://www.google.com/s2/favicons?domain=${extractHostname(url)}&sz=32`;
}

const MAX_VISIBLE_CHIPS = 3;

const PHASE_LABELS: [string, string][] = [
  ['I', 'Translation & Scan'],
  ['II', 'Field Research'],
  ['III', 'Synthesis'],
  ['IV', 'Visual Composition'],
];

function agentPhase(id: string): number {
  if (id.startsWith('scan')) return 0;
  if (id.startsWith('research')) return 1;
  if (id.startsWith('aggregat') || id.startsWith('script')) return 2;
  if (id.startsWith('visual')) return 3;
  return 1;
}

function statusDotClass(status: AgentStatus): string {
  switch (status) {
    case 'queued':
      return 'w-2 h-2 rounded-full border border-[var(--muted)]';
    case 'searching':
      return 'w-2 h-2 rounded-full bg-[var(--teal)]';
    case 'evaluating':
      return 'w-2 h-2 rounded-full bg-[var(--gold)]';
    case 'done':
      return 'w-2 h-2 rounded-full bg-[var(--green)]';
    case 'error':
      return 'w-2 h-2 rounded-full bg-red-500';
  }
}

// ── Stagger Variants ────────────────────────────────────────────

const listVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 280, damping: 22 },
  },
};

// ── Stat Value ──────────────────────────────────────────────────

interface StatValueProps {
  label: string;
  value: number;
}

function StatValue({ label, value }: StatValueProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef(value);

  useEffect(() => {
    if (value !== prevRef.current && spanRef.current) {
      prevRef.current = value;
      const el = spanRef.current;
      el.classList.add('updated');
      const timer = setTimeout(() => el.classList.remove('updated'), 500);
      return () => clearTimeout(timer);
    }
  }, [value]);

  return (
    <span className="font-sans text-[10px] uppercase tracking-[0.1em] text-[var(--muted)]">
      <span ref={spanRef} className="stat-value text-[var(--gold)] font-medium mr-1">
        {value}
      </span>
      {label}
    </span>
  );
}

// ── Elapsed Timer ───────────────────────────────────────────────

function ElapsedTimer({ startElapsed, isActive }: { startElapsed: number; isActive: boolean }) {
  const [display, setDisplay] = useState(startElapsed);

  useEffect(() => {
    if (!isActive) {
      setDisplay(startElapsed);
      return;
    }

    const base = Date.now() - startElapsed * 1000;
    const interval = setInterval(() => {
      setDisplay(Math.round((Date.now() - base) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [startElapsed, isActive]);

  return (
    <span
      className="font-sans text-[10px] text-[var(--muted)]"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {display}s
    </span>
  );
}

// ── Agent Card ──────────────────────────────────────────────────

interface AgentCardProps {
  agent: AgentState;
  onClick: () => void;
}

function AgentCard({ agent, onClick }: AgentCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    cardRef.current.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    cardRef.current.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }, []);

  const statusClass = agent.status === 'searching' || agent.status === 'evaluating'
    ? agent.status
    : '';

  const isActive = agent.status === 'searching' || agent.status === 'evaluating';

  return (
    <motion.div
      ref={cardRef}
      variants={itemVariants}
      onMouseMove={handleMouseMove}
      onClick={onClick}
      className={`agent-card ${statusClass} relative rounded-lg border border-[var(--bg4)] bg-[var(--bg2)] p-3 cursor-pointer overflow-hidden`}
      whileHover={reducedMotion ? undefined : { scale: 1.01 }}
      whileTap={reducedMotion ? undefined : { scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      role="button"
      tabIndex={0}
      aria-label={`Agent: ${agent.query}, status: ${agent.status}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      <div className="flex items-center gap-2.5">
        {/* Status dot */}
        <motion.div
          className={statusDotClass(agent.status)}
          animate={
            agent.status === 'searching' && !reducedMotion
              ? { scale: [1, 1.3, 1], opacity: [1, 0.6, 1] }
              : agent.status === 'evaluating' && !reducedMotion
                ? { scale: [1, 1.15, 1] }
                : {}
          }
          transition={
            isActive ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : {}
          }
        />

        {/* Query + elapsed */}
        <div className="flex-1 min-w-0">
          <p className="font-sans text-[13px] text-[var(--text)] truncate">
            {agent.query}
          </p>
        </div>

        {/* Elapsed timer */}
        <ElapsedTimer
          startElapsed={agent.elapsed}
          isActive={isActive}
        />
      </div>

      {/* Source chips — visible only while agent is active */}
      <AnimatePresence>
        {isActive && (agent.evaluatedSources?.length ?? 0) > 0 && (() => {
          const sources = agent.evaluatedSources!;
          const visibleSources = sources.slice(0, MAX_VISIBLE_CHIPS);
          const remaining = sources.length - visibleSources.length;

          return (
            <motion.div
              key="chips"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-wrap gap-1.5 mt-2 overflow-hidden"
            >
              {visibleSources.map((src, index) => (
                <motion.div
                  key={src.url}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg3)] border border-[var(--bg4)] text-[11px] font-sans text-[var(--muted)]"
                >
                  <img
                    src={faviconUrl(src.url)}
                    width={12}
                    height={12}
                    className="rounded-sm"
                    alt=""
                    aria-hidden="true"
                  />
                  <span>{extractHostname(src.url)}</span>
                </motion.div>
              ))}
              {remaining > 0 && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: visibleSources.length * 0.05 }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[var(--bg3)] border border-[var(--bg4)] text-[11px] font-sans text-[var(--muted)]"
                >
                  + {remaining} more
                </motion.div>
              )}
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Phase Divider ───────────────────────────────────────────────

function PhaseDivider({ number, label }: { number: string; label: string }) {
  return (
    <div className="phase-divider">
      <span className="phase-divider-dot" />
      <span className="font-serif text-[10px] uppercase tracking-[0.3em] text-[var(--gold)] whitespace-nowrap">
        Phase {number} &mdash; {label}
      </span>
      <span className="phase-divider-dot" />
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────

export function ResearchPanel() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const agents = useResearchStore((s) => s.agents);
  const segments = useResearchStore((s) => s.segments);
  const stats = useResearchStore((s) => s.stats);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // ── Toast notifications on agent state transitions ──────
  const prevAgentStatusRef = useRef<Record<string, AgentStatus>>({});

  useEffect(() => {
    const prev = prevAgentStatusRef.current;
    const entries = Object.entries(agents);

    for (const [agentId, agent] of entries) {
      const prevStatus = prev[agentId];
      if (prevStatus === agent.status) continue;

      if (agent.status === 'done' && prevStatus !== undefined) {
        toast.success(`Research complete: ${agent.query}`, {
          description: `${agent.facts?.length ?? 0} facts verified`,
          duration: 4000,
        });
      }

      if (agent.status === 'error' && prevStatus !== undefined) {
        toast.error('Research agent failed', {
          description: agent.query,
          duration: 5000,
        });
      }
    }

    // Update prev snapshot
    const next: Record<string, AgentStatus> = {};
    for (const [agentId, agent] of entries) {
      next[agentId] = agent.status;
    }
    prevAgentStatusRef.current = next;
  }, [agents]);

  // Group agents by phase
  const agentList = Object.values(agents);
  const agentsByPhase: AgentState[][] = [[], [], [], []];
  for (const agent of agentList) {
    const phase = agentPhase(agent.id);
    agentsByPhase[phase]?.push(agent);
  }

  const segmentList = Object.values(segments);
  const selectedAgent = selectedAgentId ? agents[selectedAgentId] ?? null : null;

  // Determine which phases to show (only phases with agents)
  const activePhases = PHASE_LABELS
    .map(([num, label], i) => ({ num, label, agents: agentsByPhase[i] ?? [] }))
    .filter((p) => p.agents.length > 0);

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto px-4 py-4">
      {/* Historian Panel */}
      <HistorianPanel />

      {/* Section Header */}
      <div>
        <h2 className="font-serif text-[10px] uppercase tracking-[0.4em] text-[var(--gold)] mb-2">
          Research Activity
        </h2>

        {/* Stats bar */}
        <div className="flex items-center gap-4">
          <StatValue label="sources found" value={stats.sourcesFound} />
          <span className="text-[var(--bg4)]">{'\u00B7'}</span>
          <StatValue label="facts verified" value={stats.factsVerified} />
          <span className="text-[var(--bg4)]">{'\u00B7'}</span>
          <StatValue label="segments ready" value={stats.segmentsReady} />
        </div>
      </div>

      {/* Agent cards grouped by phase */}
      <motion.div
        variants={listVariants}
        initial="hidden"
        animate="show"
        className="space-y-1"
      >
        <AnimatePresence>
          {activePhases.map((phase) => (
            <div key={phase.num}>
              <PhaseDivider number={phase.num} label={phase.label} />
              <div className="space-y-2">
                {phase.agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    onClick={() => setSelectedAgentId(agent.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </AnimatePresence>
      </motion.div>

      {/* Segments section */}
      {segmentList.length > 0 && (
        <div>
          <h2 className="font-serif text-[10px] uppercase tracking-[0.4em] text-[var(--gold)] mb-3">
            Segments
          </h2>
          <div className="space-y-3">
            {segmentList.map((segment, i) => (
              <SegmentCard key={segment.id} segment={segment} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Agent Modal */}
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
