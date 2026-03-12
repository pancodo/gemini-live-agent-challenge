import { useEffect, useRef, useCallback, useState, type MouseEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '../ui';
import { getAgentLogs, getUrlMeta } from '../../services/api';
import { typewriteEntry } from '../../hooks/useTypewriter';
import type {
  AgentState, AgentStatus, AgentLog,
  AgentLogsResponse, EvaluatedSource, UrlMeta,
} from '../../types';
import { HeroSourceCard } from './agent-modal/HeroSourceCard';
import { RelevanceBar, deriveRelevanceScore } from './agent-modal/RelevanceBar';
import { KeyFindingBanner } from './agent-modal/KeyFindingBanner';
import { AnimatedCount } from './agent-modal/AnimatedCount';
import { CompactHeader, useStickyDrawer } from './agent-modal/CompactHeader';
import { FactText } from './agent-modal/EntityPill';
import { SourceQuote, VisualPromptQuote } from './agent-modal/SourceQuote';
import { FactsCopyButton } from './agent-modal/CopyButton';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface AgentModalProps {
  agentId: string | null;
  agent: AgentState | null;
  sessionId: string;
  onClose: () => void;
}

type Tab = 'sources' | 'facts' | 'log';
type SourceFilter = 'all' | 'accepted' | 'rejected';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function extractHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function statusBadgeVariant(s: AgentStatus): 'teal' | 'gold' | 'green' | 'red' | 'muted' {
  if (s === 'searching') return 'teal';
  if (s === 'evaluating') return 'gold';
  if (s === 'done') return 'green';
  if (s === 'error') return 'red';
  return 'muted';
}

function useUrlMeta(url: string, enabled: boolean) {
  return useQuery<UrlMeta>({
    queryKey: ['urlMeta', url],
    queryFn: () => getUrlMeta(url),
    enabled,
    staleTime: 1000 * 60 * 60,
    retry: 1,
  });
}

// ─────────────────────────────────────────────────────────────
// Close Button
// ─────────────────────────────────────────────────────────────

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Close panel"
      className="flex items-center justify-center w-8 h-8 rounded-lg text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg3)] transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Live Pulse Bar
// ─────────────────────────────────────────────────────────────

function LiveBar({ isLive }: { isLive: boolean }) {
  const reducedMotion = useReducedMotion();
  if (!isLive) return null;
  return (
    <div className="h-px w-full bg-[var(--bg4)]/40 overflow-hidden">
      <motion.div
        className="h-full bg-gradient-to-r from-transparent via-[var(--gold)] to-transparent"
        animate={reducedMotion ? {} : { x: ['-100%', '100%'] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        style={{ width: '40%' }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Stats Bar
// ─────────────────────────────────────────────────────────────

function StatsBar({
  accepted, rejected, facts, elapsed,
}: {
  accepted: number; rejected: number; facts: number; elapsed: number;
}) {
  const chips = [
    { label: 'accepted', value: accepted, color: 'text-[var(--green)]' },
    { label: 'rejected', value: rejected, color: 'text-red-400' },
    { label: 'facts', value: facts, color: 'text-[var(--teal)]' },
  ].filter((c) => c.value > 0);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {chips.map((c) => (
        <span key={c.label} className={`font-sans text-[11px] ${c.color}`}>
          <AnimatedCount value={c.value} className="font-semibold" />
          <span className="text-[var(--muted)] ml-1">{c.label}</span>
        </span>
      ))}
      <span className="font-sans text-[11px] text-[var(--muted)] ml-auto" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {elapsed}s
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab Bar
// ─────────────────────────────────────────────────────────────

function TabBar({ active, onChange, counts }: {
  active: Tab;
  onChange: (t: Tab) => void;
  counts: { sources: number; facts: number; log: number };
}) {
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'sources',  label: 'Sources',   count: counts.sources },
    { id: 'facts',    label: 'Facts',     count: counts.facts },
    { id: 'log',      label: 'Field Log', count: counts.log },
  ];

  return (
    <div className="flex border-b border-[var(--bg4)]/50">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative flex items-center gap-1.5 px-4 py-3 font-sans text-[11px] uppercase tracking-[0.12em] transition-colors ${
            active === tab.id ? 'text-[var(--text)]' : 'text-[var(--muted)] hover:text-[var(--text)]/70'
          }`}
        >
          {tab.label}
          {tab.count > 0 && (
            <span className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[9px] font-sans font-medium transition-colors ${
              active === tab.id
                ? 'bg-[var(--text)] text-[var(--bg)]'
                : 'bg-[var(--bg4)] text-[var(--muted)]'
            }`}>
              <AnimatedCount value={tab.count} />
            </span>
          )}
          {active === tab.id && (
            <motion.div
              layoutId="drawer-tab-line"
              className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--text)] rounded-t-full"
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Source Filter Pills
// ─────────────────────────────────────────────────────────────

function FilterPills({ active, onChange, accepted, rejected }: {
  active: SourceFilter;
  onChange: (f: SourceFilter) => void;
  accepted: number;
  rejected: number;
}) {
  const filters: { id: SourceFilter; label: string; count: number }[] = [
    { id: 'all',      label: 'All',      count: accepted + rejected },
    { id: 'accepted', label: 'Accepted', count: accepted },
    { id: 'rejected', label: 'Rejected', count: rejected },
  ];

  return (
    <div className="flex gap-1.5 flex-wrap">
      {filters.map((f) => (
        <button
          key={f.id}
          onClick={() => onChange(f.id)}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full font-sans text-[11px] border transition-all ${
            active === f.id
              ? f.id === 'accepted'
                ? 'bg-[var(--green)]/15 border-[var(--green)]/40 text-[var(--green)]'
                : f.id === 'rejected'
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-[var(--text)]/8 border-[var(--bg4)] text-[var(--text)]'
              : 'bg-transparent border-[var(--bg4)]/50 text-[var(--muted)] hover:border-[var(--bg4)]'
          }`}
        >
          {f.id === 'accepted' && <span className="text-[9px]">✓</span>}
          {f.id === 'rejected' && <span className="text-[9px]">✕</span>}
          {f.label}
          <span className="opacity-60">{f.count}</span>
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Download Icon Button (appears on image hover)
// ─────────────────────────────────────────────────────────────

function ImageDownloadButton({ imageUrl, filename }: { imageUrl: string; filename: string }) {
  const handleDownload = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <button
      onClick={handleDownload}
      aria-label="Download image"
      className="absolute bottom-2 right-2 z-20 flex items-center justify-center w-7 h-7 rounded-lg bg-black/60 backdrop-blur-sm text-white/80 hover:bg-black/80 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-auto"
    >
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
        <path d="M6.5 1v7M3.5 5.5l3 3 3-3M2 10h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// OG Image Zone
// ─────────────────────────────────────────────────────────────

function OgImageZone({ imageUrl, hostname, isLoading }: {
  imageUrl: string | null | undefined;
  hostname: string;
  isLoading: boolean;
}) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const showImage = imageUrl && !imgError;
  const showSkeleton = isLoading || (showImage && !imageLoaded);
  const showFallback = !isLoading && (!showImage || imgError);

  return (
    <div className="group relative w-full h-[140px] overflow-hidden bg-[var(--bg3)] rounded-t-xl">
      {showSkeleton && <div className="absolute inset-0 log-source evaluating" />}
      {showImage && (
        <img
          src={imageUrl}
          alt={hostname}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setImageLoaded(true)}
          onError={() => { setImgError(true); setImageLoaded(false); }}
        />
      )}
      {showFallback && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, var(--bg3) 0%, var(--bg4) 100%)' }}
        >
          <span className="font-serif text-[40px] leading-none select-none" style={{ color: 'var(--gold)', opacity: 0.35 }}>
            {hostname[0]?.toUpperCase() ?? '?'}
          </span>
        </div>
      )}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(to bottom, transparent 50%, rgba(0,0,0,0.22) 100%)' }} />
      {showImage && imageLoaded && (
        <ImageDownloadButton imageUrl={imageUrl} filename={`${hostname}-source.jpg`} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Source Card
// ─────────────────────────────────────────────────────────────

function SourceCard({ source, index, isLive }: { source: EvaluatedSource; index: number; isLive: boolean }) {
  const [faviconError, setFaviconError] = useState(false);
  const host = extractHostname(source.url);

  const needsMeta = !source.imageUrl;
  const { data: meta, isLoading: metaLoading } = useUrlMeta(source.url, needsMeta);

  const imageUrl = source.imageUrl ?? meta?.image ?? null;
  const title = source.title ?? meta?.title ?? host;
  const description = source.description ?? meta?.description ?? null;
  const favicon = source.favicon ?? meta?.favicon ?? `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  const isImageLoading = needsMeta && metaLoading;

  return (
    <motion.div
      initial={isLive ? { opacity: 0, y: 8 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26, delay: index * 0.035 }}
      className={`group relative flex flex-col rounded-xl border overflow-hidden hover:shadow-md transition-shadow ${
        source.accepted
          ? 'border-[var(--green)]/25 bg-[var(--bg)]/60'
          : 'border-[var(--bg4)]/60 bg-[var(--bg)]/60 opacity-70 hover:opacity-90'
      }`}
    >
      <OgImageZone imageUrl={imageUrl} hostname={host} isLoading={isImageLoading} />

      {/* Status badge — sits at bottom of image */}
      <div className={`absolute top-2.5 left-2.5 flex items-center gap-1 px-2 py-0.5 rounded-full backdrop-blur-sm font-sans text-[9px] uppercase tracking-[0.15em] z-10 ${
        source.accepted
          ? 'bg-[var(--green)]/90 text-white'
          : 'bg-black/50 text-white/70'
      }`}>
        {source.accepted ? '✓' : '✕'}
        {source.accepted ? ' Accepted' : ' Rejected'}
      </div>

      <div className="flex flex-col gap-1.5 p-3">
        {/* Favicon + domain */}
        <div className="flex items-center gap-1.5">
          {!faviconError ? (
            <img src={favicon} alt="" width={14} height={14} className="rounded-sm shrink-0" onError={() => setFaviconError(true)} />
          ) : (
            <span className="w-3.5 h-3.5 rounded-sm bg-[var(--bg4)] shrink-0 flex items-center justify-center text-[8px] text-[var(--muted)]">{host[0]?.toUpperCase()}</span>
          )}
          <span className="font-sans text-[10px] text-[var(--muted)] truncate">{host}</span>
        </div>

        {/* Title */}
        <p className="font-serif text-[13px] text-[var(--text)] leading-snug line-clamp-2">{title}</p>

        {/* Description */}
        {description && (
          <p className="font-sans text-[11px] text-[var(--muted)] leading-relaxed line-clamp-2">{description}</p>
        )}

        {/* Relevance score bar */}
        <RelevanceBar score={deriveRelevanceScore(source)} />

        {/* Reason — styled as pull-quote */}
        <SourceQuote text={source.reason} index={index} />

        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 font-sans text-[10px] text-[var(--gold)] hover:underline self-start mt-auto pt-0.5"
        >
          Visit ↗
        </a>
      </div>
    </motion.div>
  );
}

function ShimmerCard() {
  return (
    <div className="rounded-xl border border-[var(--bg4)]/50 overflow-hidden">
      <div className="w-full h-[140px] log-source evaluating" />
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-sm bg-[var(--bg4)] log-source evaluating" />
          <div className="h-2.5 w-16 rounded bg-[var(--bg4)] log-source evaluating" />
        </div>
        <div className="h-3.5 w-3/4 rounded bg-[var(--bg4)] log-source evaluating" />
        <div className="h-2.5 w-full rounded bg-[var(--bg4)] log-source evaluating" />
        <div className="h-2.5 w-2/3 rounded bg-[var(--bg4)] log-source evaluating" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Facts Tab
// ─────────────────────────────────────────────────────────────

function FactsTab({ facts, visualResearchPrompt }: { facts: string[]; visualResearchPrompt?: string }) {
  if (facts.length === 0) {
    return <EmptyState label="No facts extracted yet." />;
  }

  return (
    <div className="space-y-3">
      {/* Facts header row with copy button */}
      <div className="flex items-center justify-between">
        <span className="font-sans text-[11px] uppercase tracking-[0.12em] text-[var(--muted)]">
          Facts <span className="ml-1 text-[var(--text)]">{facts.length}</span>
        </span>
        <FactsCopyButton facts={facts} />
      </div>

      {/* Timeline */}
      <div className="relative pl-6">
        {/* Vertical connector line */}
        <div className="absolute left-[9px] top-2 bottom-2 w-px bg-[var(--bg4)]" />

        <motion.div
          className="space-y-3"
          variants={{ show: { transition: { staggerChildren: 0.055 } } }}
          initial="hidden"
          animate="show"
        >
          {facts.map((fact, i) => (
            <motion.div
              key={i}
              variants={{
                hidden: { opacity: 0, x: -6 },
                show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 320, damping: 24 } },
              }}
              className="relative"
            >
              {/* Timeline dot */}
              <div className="absolute -left-6 top-[5px] w-[10px] h-[10px] rounded-full border-2 border-[var(--green)] bg-[var(--bg2)]" />
              <div className="bg-[var(--bg)]/70 border border-[var(--bg4)]/50 rounded-lg px-3 py-2.5">
                <FactText fact={fact} />
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* Visual prompt blockquote */}
      {visualResearchPrompt && (
        <div className="mt-2">
          <VisualPromptQuote prompt={visualResearchPrompt} />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Log Tab
// ─────────────────────────────────────────────────────────────

function TypewriterEntry({ log, shouldAnimate }: { log: AgentLog; shouldAnimate: boolean }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const animated = useRef(false);

  useEffect(() => {
    if (shouldAnimate && textRef.current && !animated.current) {
      animated.current = true;
      typewriteEntry(textRef.current, log.step, 20);
    }
  }, [shouldAnimate, log.step]);

  return (
    <motion.li
      variants={{
        hidden: { opacity: 0, y: 6, filter: 'blur(2px)' },
        show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 280, damping: 22 } },
      }}
      className="flex gap-3 items-start py-1"
    >
      <span className="text-[var(--gold)] text-[9px] mt-1.5 shrink-0">◆</span>
      <span ref={textRef} className="flex-1 font-sans text-[12px] text-[var(--text)] leading-relaxed">
        {shouldAnimate ? '' : log.step}
      </span>
      <span className="font-sans text-[10px] text-[var(--muted)] shrink-0 mt-0.5 tabular-nums">{log.ts}</span>
    </motion.li>
  );
}

function LogTab({ logs, isLive }: { logs: AgentLog[]; isLive: boolean }) {
  if (logs.length === 0) return <EmptyState label={isLive ? 'Waiting for log entries…' : 'No log entries.'} />;

  return (
    <motion.ul
      className="divide-y divide-[var(--bg4)]/30"
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
    >
      <AnimatePresence>
        {logs.map((log, i) => (
          <TypewriterEntry key={`${log.ts}-${i}`} log={log} shouldAnimate={isLive} />
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}

// ─────────────────────────────────────────────────────────────
// Empty State
// ─────────────────────────────────────────────────────────────

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 gap-2">
      <span className="text-[var(--bg4)] text-2xl">◈</span>
      <p className="font-sans text-[12px] text-[var(--muted)]">{label}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// AgentModal — right-side drawer
// ─────────────────────────────────────────────────────────────

export function AgentModal({ agentId, agent, sessionId, onClose }: AgentModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('sources');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const reducedMotion = useReducedMotion();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { isCompact, sentinelRef } = useStickyDrawer(scrollContainerRef);

  const { data: logsData } = useQuery<AgentLogsResponse>({
    queryKey: ['agentLogs', sessionId, agentId],
    queryFn: () => getAgentLogs(sessionId, agentId!),
    enabled: !!agentId && agent?.status === 'done',
    staleTime: Infinity,
  });

  const logs: AgentLog[] = logsData?.logs ?? agent?.logs ?? [];
  const isLive = agent?.status === 'searching' || agent?.status === 'evaluating';
  const evaluatedSources = agent?.evaluatedSources ?? [];
  const facts = agent?.facts ?? [];

  const acceptedSources = evaluatedSources.filter((s) => s.accepted);
  const rejectedSources = evaluatedSources.filter((s) => !s.accepted);

  // Auto-switch tabs as data arrives
  useEffect(() => {
    if (evaluatedSources.length > 0) { setActiveTab('sources'); setSourceFilter('all'); }
  }, [evaluatedSources.length]);
  useEffect(() => {
    if (facts.length > 0 && evaluatedSources.length === 0) setActiveTab('facts');
  }, [facts.length, evaluatedSources.length]);

  const handleClose = useCallback(() => onClose(), [onClose]);

  return (
    <Dialog.Root open={!!agentId} onOpenChange={(open) => { if (!open) handleClose(); }}>
      <Dialog.Portal>
        <AnimatePresence>
          {!!agentId && (
            <>
              {/* Backdrop — lighter than modal, keeps workspace visible */}
              <Dialog.Overlay asChild>
                <motion.div
                  key="backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-50"
                />
              </Dialog.Overlay>

              {/* Drawer — slides in from right */}
              <Dialog.Content asChild>
                <motion.div
                  key="drawer"
                  initial={reducedMotion ? { opacity: 0 } : { x: '100%', opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={reducedMotion ? { opacity: 0 } : { x: '100%', opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 32, mass: 0.9 }}
                  className="fixed right-0 top-0 bottom-0 z-50 flex flex-col w-[520px] max-w-[95vw] bg-[var(--bg2)] border-l border-[var(--bg4)] shadow-2xl overflow-hidden"
                >
                  {/* ── Header ── */}
                  <div className="flex flex-col gap-3 px-5 pt-5 pb-3 shrink-0">
                    <div className="flex items-start gap-3">
                      {/* Status dot */}
                      <motion.div
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                          isLive ? 'bg-[var(--teal)]' :
                          agent?.status === 'done' ? 'bg-[var(--green)]' :
                          agent?.status === 'error' ? 'bg-red-500' :
                          'bg-[var(--muted)]'
                        }`}
                        animate={isLive ? { scale: [1, 1.4, 1], opacity: [1, 0.5, 1] } : {}}
                        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                      />

                      {/* Query title */}
                      <Dialog.Title className="flex-1 font-serif text-[17px] font-normal text-[var(--text)] leading-snug">
                        {agent?.query ?? 'Agent Details'}
                      </Dialog.Title>

                      <CloseButton onClose={handleClose} />
                    </div>

                    {/* Status badge + stats */}
                    <div className="flex items-center gap-2 pl-5">
                      <Badge variant={statusBadgeVariant(agent?.status ?? 'queued')}>
                        {agent?.status ?? 'queued'}
                      </Badge>
                      <StatsBar
                        accepted={acceptedSources.length}
                        rejected={rejectedSources.length}
                        facts={facts.length}
                        elapsed={agent?.elapsed ?? 0}
                      />
                    </div>
                  </div>

                  {/* Live scanning bar */}
                  <LiveBar isLive={isLive} />

                  {/* ── Tab Bar ── */}
                  <div className="px-5 shrink-0">
                    <TabBar
                      active={activeTab}
                      onChange={setActiveTab}
                      counts={{ sources: evaluatedSources.length, facts: facts.length, log: logs.length }}
                    />
                  </div>

                  {/* ── Scrollable Content ── */}
                  <div ref={scrollContainerRef} className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'var(--bg4) transparent' }}>
                    {/* ── Compact sticky header (appears on scroll, inside scroll container) ── */}
                    <AnimatePresence>
                      {isCompact && (
                        <CompactHeader
                          query={agent?.query ?? ''}
                          status={agent?.status ?? 'queued'}
                          isLive={isLive}
                          activeTab={activeTab}
                          onTabChange={setActiveTab}
                          counts={{ sources: evaluatedSources.length, facts: facts.length, log: logs.length }}
                        />
                      )}
                    </AnimatePresence>

                    {/* Sentinel for sticky header IntersectionObserver */}
                    <div ref={sentinelRef} className="h-px" />
                    <div className="px-5 py-4">
                      <VisuallyHidden>
                        <Dialog.Description>
                          Research agent details for: {agent?.query}
                        </Dialog.Description>
                      </VisuallyHidden>

                      <AnimatePresence mode="wait">
                        {/* ── Sources ── */}
                        {activeTab === 'sources' && (
                          <motion.div
                            key="sources"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="space-y-3"
                          >
                            {/* Key finding banner — shown when research is done */}
                            {evaluatedSources.length > 0 && agent?.status === 'done' && (
                              <KeyFindingBanner
                                query={agent.query}
                                acceptedCount={acceptedSources.length}
                                rejectedCount={rejectedSources.length}
                                visualResearchPrompt={agent.visualResearchPrompt}
                              />
                            )}

                            {/* Filter pills */}
                            {evaluatedSources.length > 0 && (
                              <FilterPills
                                active={sourceFilter}
                                onChange={setSourceFilter}
                                accepted={acceptedSources.length}
                                rejected={rejectedSources.length}
                              />
                            )}

                            {/* Hero source — first accepted, full-width above grid */}
                            {acceptedSources[0] && (sourceFilter === 'all' || sourceFilter === 'accepted') && (
                              <HeroSourceCard source={acceptedSources[0]} isLive={isLive} />
                            )}

                            {/* Source grid — remaining sources */}
                            {(() => {
                              const gridSources =
                                sourceFilter === 'accepted' ? acceptedSources.slice(1) :
                                sourceFilter === 'rejected' ? rejectedSources :
                                [...acceptedSources.slice(1), ...rejectedSources];

                              return gridSources.length > 0 ? (
                                <div className="grid grid-cols-2 gap-3">
                                  {gridSources.map((src, i) => (
                                    <SourceCard key={src.url + i} source={src} index={i} isLive={isLive} />
                                  ))}
                                  {agent?.status === 'evaluating' && <ShimmerCard />}
                                </div>
                              ) : agent?.status === 'evaluating' && evaluatedSources.length === 0 ? (
                                <div className="grid grid-cols-2 gap-3">
                                  {[0, 1, 2, 3].map((i) => <ShimmerCard key={i} />)}
                                </div>
                              ) : !acceptedSources[0] && gridSources.length === 0 ? (
                                <EmptyState label={
                                  sourceFilter !== 'all'
                                    ? `No ${sourceFilter} sources.`
                                    : isLive ? 'Fetching sources…' : 'No sources recorded.'
                                } />
                              ) : null;
                            })()}
                          </motion.div>
                        )}

                        {/* ── Facts ── */}
                        {activeTab === 'facts' && (
                          <motion.div
                            key="facts"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                          >
                            <FactsTab facts={facts} visualResearchPrompt={agent?.visualResearchPrompt} />
                          </motion.div>
                        )}

                        {/* ── Log ── */}
                        {activeTab === 'log' && (
                          <motion.div
                            key="log"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.15 }}
                          >
                            <LogTab logs={logs} isLive={isLive} />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                </motion.div>
              </Dialog.Content>
            </>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
