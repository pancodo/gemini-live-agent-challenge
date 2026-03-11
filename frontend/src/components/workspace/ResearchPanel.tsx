import { useState, useEffect, useRef, useCallback, useMemo, memo, type MouseEvent, type ReactNode } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useResearchStore } from '../../store/researchStore';
import { useSessionStore } from '../../store/sessionStore';
import { usePlayerStore } from '../../store/playerStore';
import { HistorianPanel } from './HistorianPanel';
import { AgentModal } from './AgentModal';
import { SegmentCard } from './SegmentCard';
import { usePDFViewer } from './PDFViewerContext';
import type { AgentState, AgentStatus, EvaluatedSource, Segment } from '../../types';

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

// ── Stat Button (clickable with popover) ────────────────────────

interface StatButtonProps {
  label: string;
  value: number;
  popover: ReactNode;
}

function StatButton({ label, value, popover }: StatButtonProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef(value);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value !== prevRef.current && spanRef.current) {
      prevRef.current = value;
      const el = spanRef.current;
      el.classList.add('updated');
      const timer = setTimeout(() => el.classList.remove('updated'), 500);
      return () => clearTimeout(timer);
    }
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: globalThis.MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="font-sans text-[10px] uppercase tracking-[0.1em] text-[var(--muted)] hover:text-[var(--gold-d)] transition-colors cursor-pointer group"
      >
        <span ref={spanRef} className="stat-value text-[var(--gold)] font-medium mr-1 group-hover:text-[var(--gold-d)]">
          {value}
        </span>
        {label}
        <span className="ml-1 opacity-40 group-hover:opacity-70">↓</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            key="popover"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className="absolute left-0 top-[calc(100%+8px)] z-50 w-72 max-h-72 overflow-y-auto rounded-lg border border-[var(--bg4)] bg-[var(--bg2)] shadow-lg p-3"
          >
            {popover}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Popover content components ───────────────────────────────────

function SourcesPopover({ agents }: { agents: Record<string, AgentState> }) {
  const all: (EvaluatedSource & { agentQuery: string })[] = [];
  for (const agent of Object.values(agents)) {
    for (const src of agent.evaluatedSources ?? []) {
      all.push({ ...src, agentQuery: agent.query });
    }
  }
  if (all.length === 0) return <p className="font-sans text-[12px] text-[var(--muted)] text-center py-2">No sources yet</p>;
  return (
    <div className="flex flex-col gap-2">
      {all.map((src, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${src.accepted ? 'bg-[var(--green)]' : 'bg-red-400'}`} />
          <div className="min-w-0">
            <a
              href={src.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-[12px] text-[var(--gold)] hover:underline truncate block leading-tight"
            >
              {src.title ?? new URL(src.url).hostname.replace(/^www\./, '')}
            </a>
            {src.reason && (
              <p className="font-sans text-[11px] text-[var(--muted)] mt-0.5 leading-snug">{src.reason}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function FactsPopover({ agents, onEntityClick }: { agents: Record<string, AgentState>; onEntityClick?: (text: string) => void }) {
  const groups: { query: string; facts: string[] }[] = [];
  for (const agent of Object.values(agents)) {
    if (agent.facts && agent.facts.length > 0) {
      groups.push({ query: agent.query, facts: agent.facts });
    }
  }
  if (groups.length === 0) return <p className="font-sans text-[12px] text-[var(--muted)] text-center py-2">No facts yet</p>;
  return (
    <div className="flex flex-col gap-3">
      {groups.map((g, gi) => (
        <div key={gi}>
          <button
            type="button"
            onClick={() => onEntityClick?.(g.query)}
            className="font-sans text-[10px] uppercase tracking-[0.1em] text-[var(--muted)] mb-1 truncate block text-left cursor-pointer hover:text-[var(--gold)] transition-colors"
          >
            {g.query}
          </button>
          <ul className="flex flex-col gap-1">
            {g.facts.map((fact, fi) => (
              <li key={fi} className="flex items-start gap-1.5">
                <span className="mt-1.5 w-1 h-1 rounded-full bg-[var(--gold)] shrink-0 opacity-60" />
                <button
                  type="button"
                  onClick={() => onEntityClick?.(fact)}
                  className="font-sans text-[12px] text-[var(--text)] leading-snug text-left cursor-pointer hover:text-[var(--gold)] transition-colors"
                >
                  {fact}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SegmentsPopover({ segments, triggerIris }: { segments: Record<string, Segment>; triggerIris: (path: string) => void }) {
  const ready = Object.values(segments).filter((s) => s.status === 'ready' || s.status === 'complete');
  if (ready.length === 0) return <p className="font-sans text-[12px] text-[var(--muted)] text-center py-2">No segments ready yet</p>;
  return (
    <div className="flex flex-col gap-2">
      {ready.map((seg, i) => (
        <div key={seg.id} className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-sans text-[12px] text-[var(--text)] truncate">{String(i + 1).padStart(2, '0')}. {seg.title}</p>
            {seg.mood && <p className="font-sans text-[10px] text-[var(--muted)] uppercase tracking-[0.1em]">{seg.mood}</p>}
          </div>
          <button
            type="button"
            onClick={() => triggerIris(`/player/${seg.id}`)}
            className="shrink-0 font-sans text-[10px] uppercase tracking-[0.1em] text-[var(--gold)] hover:text-[var(--gold-d)] transition-colors"
          >
            Watch →
          </button>
        </div>
      ))}
    </div>
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
  onEntityClick?: (text: string) => void;
}

const AgentCard = memo(function AgentCard({ agent, onClick, onEntityClick }: AgentCardProps) {
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
    : agent.status === 'error'
      ? 'error'
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
                : agent.status === 'error' && !reducedMotion
                  ? { x: [0, -2, 2, -1, 1, 0] }
                  : {}
          }
          transition={
            isActive
              ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
              : agent.status === 'error'
                ? { duration: 0.4, ease: 'easeOut' }
                : {}
          }
        />

        {/* Query + elapsed */}
        <div className="flex-1 min-w-0">
          <p className="font-sans text-[13px] text-[var(--text)] truncate">
            <span
              role="link"
              tabIndex={-1}
              className="cursor-pointer hover:text-[var(--gold)] transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                onEntityClick?.(agent.query);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.stopPropagation();
                  onEntityClick?.(agent.query);
                }
              }}
            >
              {agent.query}
            </span>
          </p>
          <AnimatePresence>
            {agent.status === 'error' && agent.errorMessage && (
              <motion.p
                key="error-msg"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="font-sans text-[11px] text-red-400 mt-1 leading-snug line-clamp-2"
              >
                {agent.errorMessage}
              </motion.p>
            )}
          </AnimatePresence>
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
});

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
  const agents = useResearchStore(useShallow((s) => s.agents));
  const segments = useResearchStore(useShallow((s) => s.segments));
  const stats = useResearchStore((s) => s.stats);
  const triggerIris = usePlayerStore((s) => s.triggerIris);
  const pdfViewer = usePDFViewer();

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  const handleEntityClick = useCallback((text: string) => {
    pdfViewer?.scrollToEntity(text);
  }, [pdfViewer]);

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
          description: agent.errorMessage ?? agent.query,
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

  const activePhases = useMemo(() => {
    const byPhase: AgentState[][] = [[], [], [], []];
    for (const agent of Object.values(agents)) {
      const phase = agentPhase(agent.id);
      byPhase[phase]?.push(agent);
    }
    return PHASE_LABELS
      .map(([num, label], i) => ({ num, label, agents: byPhase[i] ?? [] }))
      .filter((p) => p.agents.length > 0);
  }, [agents]);

  const segmentList = useMemo(() => Object.values(segments), [segments]);
  const selectedAgent = selectedAgentId ? agents[selectedAgentId] ?? null : null;

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable content area */}
      <div className="flex-1 flex flex-col gap-4 overflow-y-auto px-4 py-4">
        {/* Historian Panel */}
        <HistorianPanel />

        {/* Section Header */}
        <div>
          <h2 className="font-serif text-[10px] uppercase tracking-[0.4em] text-[var(--gold)] mb-2">
            Research Activity
          </h2>
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
                      onEntityClick={handleEntityClick}
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
      </div>

      {/* Sticky stats footer — always visible */}
      <div
        className="shrink-0 flex items-center gap-4 px-4 py-2"
        style={{
          background: 'var(--bg2)',
          borderTop: '1px solid rgba(139,94,26,0.12)',
        }}
      >
        <StatButton
          label="sources found"
          value={stats.sourcesFound}
          popover={<SourcesPopover agents={agents} />}
        />
        <span className="text-[var(--bg4)]">{'\u00B7'}</span>
        <StatButton
          label="facts verified"
          value={stats.factsVerified}
          popover={<FactsPopover agents={agents} onEntityClick={handleEntityClick} />}
        />
        <span className="text-[var(--bg4)]">{'\u00B7'}</span>
        <StatButton
          label="segments ready"
          value={stats.segmentsReady}
          popover={<SegmentsPopover segments={segments} triggerIris={triggerIris} />}
        />
      </div>

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
