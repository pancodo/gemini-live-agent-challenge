import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { Modal, Badge } from '../ui';
import { getAgentLogs, getUrlMeta } from '../../services/api';
import { typewriteEntry } from '../../hooks/useTypewriter';
import type { AgentState, AgentStatus, AgentLog, AgentLogsResponse, EvaluatedSource, UrlMeta } from '../../types';

// ── Props ───────────────────────────────────────────────────────

interface AgentModalProps {
  agentId: string | null;
  agent: AgentState | null;
  sessionId: string;
  onClose: () => void;
}

// ── Helpers ─────────────────────────────────────────────────────

type Tab = 'sources' | 'facts' | 'log';

function extractHostname(url: string): string {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch { return url; }
}

function statusBadgeVariant(status: AgentStatus): 'teal' | 'gold' | 'green' | 'red' | 'muted' {
  switch (status) {
    case 'searching': return 'teal';
    case 'evaluating': return 'gold';
    case 'done': return 'green';
    case 'error': return 'red';
    default: return 'muted';
  }
}

// ── useUrlMeta hook ──────────────────────────────────────────────

function useUrlMeta(url: string, enabled: boolean) {
  return useQuery<UrlMeta>({
    queryKey: ['urlMeta', url],
    queryFn: () => getUrlMeta(url),
    enabled,
    staleTime: 1000 * 60 * 60, // 1 hour
    retry: 1,
  });
}

// ── Tab Bar ─────────────────────────────────────────────────────

interface TabBarProps {
  active: Tab;
  onChange: (t: Tab) => void;
  counts: { sources: number; facts: number; log: number };
}

function TabBar({ active, onChange, counts }: TabBarProps) {
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'sources', label: 'Sources', count: counts.sources },
    { id: 'facts',   label: 'Facts',   count: counts.facts },
    { id: 'log',     label: 'Field Log', count: counts.log },
  ];

  return (
    <div className="flex gap-1 px-6 pb-0 border-b border-[var(--bg4)]/60 mb-0">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative flex items-center gap-1.5 px-3 py-2.5 font-sans text-[11px] uppercase tracking-[0.15em] transition-colors duration-150 ${
            active === tab.id
              ? 'text-[var(--gold)]'
              : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          {tab.label}
          {tab.count > 0 && (
            <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full font-sans text-[9px] ${
              active === tab.id
                ? 'bg-[var(--gold)] text-white'
                : 'bg-[var(--bg4)] text-[var(--muted)]'
            }`}>
              {tab.count}
            </span>
          )}
          {active === tab.id && (
            <motion.span
              layoutId="tab-underline"
              className="absolute bottom-0 left-0 right-0 h-px bg-[var(--gold)]"
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

// ── OG Image Zone ────────────────────────────────────────────────

interface OgImageZoneProps {
  imageUrl: string | null | undefined;
  hostname: string;
  isLoading: boolean;
}

function OgImageZone({ imageUrl, hostname, isLoading }: OgImageZoneProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  const showImage = imageUrl && !imgError;
  const showSkeleton = isLoading || (showImage && !imageLoaded);
  const showFallback = !isLoading && (!showImage || imgError);

  return (
    <div className="relative w-full h-[160px] overflow-hidden rounded-t-xl bg-[var(--bg3)]">
      {/* Skeleton shimmer — shown while loading metadata or while image hasn't decoded yet */}
      {showSkeleton && (
        <div className="absolute inset-0 log-source evaluating" aria-hidden="true" />
      )}

      {/* Actual OG image */}
      {showImage && (
        <img
          src={imageUrl}
          alt={hostname}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setImageLoaded(true)}
          onError={() => { setImgError(true); setImageLoaded(false); }}
        />
      )}

      {/* Gradient fallback when no image or error */}
      {showFallback && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, var(--bg3) 0%, var(--bg4) 100%)' }}
        >
          <span
            className="font-serif text-[48px] font-normal leading-none select-none"
            style={{ color: 'var(--gold)', opacity: 0.45 }}
          >
            {hostname[0]?.toUpperCase() ?? '?'}
          </span>
        </div>
      )}

      {/* Subtle bottom fade to blend into card body */}
      <div
        className="absolute bottom-0 left-0 right-0 h-10 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, transparent, rgba(0,0,0,0.18))' }}
        aria-hidden="true"
      />
    </div>
  );
}

// ── Source Card ─────────────────────────────────────────────────

interface SourceCardProps {
  source: EvaluatedSource;
  index: number;
  isLive: boolean;
}

function SourceCard({ source, index, isLive }: SourceCardProps) {
  const [faviconError, setFaviconError] = useState(false);
  const host = extractHostname(source.url);

  // Only fetch metadata when the source doesn't already have an imageUrl
  const needsMeta = !source.imageUrl;
  const { data: meta, isLoading: metaLoading } = useUrlMeta(source.url, needsMeta);

  // Resolve display values: prefer pre-populated fields, fall back to fetched meta
  const resolvedImageUrl = source.imageUrl ?? meta?.image ?? null;
  const resolvedTitle = source.title ?? meta?.title ?? host;
  const resolvedDescription = source.description ?? meta?.description ?? null;
  const resolvedFavicon = source.favicon ?? meta?.favicon ?? null;
  const isImageLoading = needsMeta && metaLoading;

  // Fallback favicon via Google S2 service if no direct favicon URL
  const faviconSrc = resolvedFavicon
    ? resolvedFavicon
    : `https://www.google.com/s2/favicons?domain=${host}&sz=32`;

  return (
    <motion.div
      initial={isLive ? { opacity: 0, y: 10, scale: 0.97 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24, delay: index * 0.04 }}
      className={`relative flex flex-col rounded-xl border overflow-hidden transition-colors ${
        source.accepted
          ? 'border-[var(--green)]/30 bg-[var(--green)]/5'
          : 'border-red-500/20 bg-red-500/5'
      }`}
    >
      {/* OG image zone — full width, 160px tall */}
      <OgImageZone
        imageUrl={resolvedImageUrl}
        hostname={host}
        isLoading={isImageLoading}
      />

      {/* Accepted / Rejected ribbon — layered over the top-right of the image */}
      <div className={`absolute top-0 right-0 px-2 py-0.5 font-sans text-[9px] uppercase tracking-[0.2em] rounded-bl-lg z-10 ${
        source.accepted
          ? 'bg-[var(--green)]/80 text-white'
          : 'bg-red-500/80 text-white'
      }`}>
        {source.accepted ? '✓ Accepted' : '✕ Rejected'}
      </div>

      {/* Card body */}
      <div className="flex flex-col gap-2 p-4">
        {/* Favicon + domain row */}
        <div className="flex items-center gap-2">
          {!faviconError ? (
            <img
              src={faviconSrc}
              alt={host}
              width={16}
              height={16}
              className="rounded-sm shrink-0 object-contain"
              onError={() => setFaviconError(true)}
            />
          ) : (
            <span className="w-4 h-4 rounded-sm bg-[var(--bg4)] flex items-center justify-center text-[8px] text-[var(--muted)] shrink-0 font-sans">
              {host[0]?.toUpperCase()}
            </span>
          )}
          <span className="font-sans text-[10px] text-[var(--muted)] uppercase tracking-[0.1em] truncate">
            {host}
          </span>
        </div>

        {/* Title — bold, 2 lines max */}
        <p className="font-serif text-[14px] font-semibold text-[var(--text)] leading-snug line-clamp-2">
          {resolvedTitle}
        </p>

        {/* Description snippet — 2 lines, muted */}
        {resolvedDescription && (
          <p className="font-sans text-[12px] text-[var(--muted)] leading-relaxed line-clamp-2">
            {resolvedDescription}
          </p>
        )}

        {/* Reason */}
        {source.reason && (
          <p className="font-sans text-[11px] text-[var(--muted)]/80 leading-relaxed border-t border-[var(--bg4)]/50 pt-2 mt-0.5">
            <span className="font-sans text-[10px] uppercase tracking-[0.12em] text-[var(--muted)] mr-1">
              Reason:
            </span>
            {source.reason}
          </p>
        )}

        {/* Open source link */}
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 font-sans text-[11px] text-[var(--gold)] hover:text-[var(--gold-d)] transition-colors self-end mt-auto pt-1"
          onClick={(e) => e.stopPropagation()}
        >
          <span>Open source</span>
          <span className="text-[10px]">↗</span>
        </a>
      </div>
    </motion.div>
  );
}

// ── Shimmer Source Card ──────────────────────────────────────────

function ShimmerCard() {
  return (
    <div className="rounded-xl border border-[var(--bg4)]/60 bg-[var(--bg)]/50 overflow-hidden">
      {/* Image zone shimmer */}
      <div className="w-full h-[160px] log-source evaluating" />
      {/* Body shimmer */}
      <div className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-sm bg-[var(--bg4)] log-source evaluating" />
          <div className="h-2.5 w-20 rounded bg-[var(--bg4)] log-source evaluating" />
        </div>
        <div className="h-4 w-3/4 rounded bg-[var(--bg4)] log-source evaluating" />
        <div className="h-3 w-full rounded bg-[var(--bg4)] log-source evaluating" />
        <div className="h-3 w-2/3 rounded bg-[var(--bg4)] log-source evaluating" />
      </div>
    </div>
  );
}

// ── Facts Tab ───────────────────────────────────────────────────

function FactsTab({ facts }: { facts: string[] }) {
  if (facts.length === 0) {
    return (
      <p className="font-sans text-[13px] text-[var(--muted)] text-center py-10">
        No facts extracted yet.
      </p>
    );
  }

  return (
    <motion.div
      className="space-y-2"
      variants={{ show: { transition: { staggerChildren: 0.06 } } }}
      initial="hidden"
      animate="show"
    >
      {facts.map((fact, i) => (
        <motion.div
          key={i}
          variants={{
            hidden: { opacity: 0, x: -8 },
            show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
          }}
          className="flex gap-3 items-start rounded-lg border border-[var(--green)]/20 bg-[var(--green)]/5 px-4 py-3"
        >
          <span className="text-[var(--green)] text-[11px] mt-0.5 shrink-0 font-serif">
            {String(i + 1).padStart(2, '0')}
          </span>
          <p className="font-sans text-[13px] text-[var(--text)] leading-relaxed">{fact}</p>
        </motion.div>
      ))}

      {/* Visual Prompt — inside facts tab if available */}
    </motion.div>
  );
}

// ── Log Tab ─────────────────────────────────────────────────────

interface LogTabProps {
  logs: AgentLog[];
  isLive: boolean;
  visualResearchPrompt?: string;
}

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
        hidden: { opacity: 0, y: 8, filter: 'blur(3px)' },
        show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { type: 'spring', stiffness: 280, damping: 22 } },
      }}
      className="flex gap-3 items-start"
    >
      <span className="text-[var(--gold)] text-[10px] mt-1 shrink-0">{'\u25C6'}</span>
      <span ref={textRef} className="flex-1 font-sans text-[13px] text-[var(--text)] leading-relaxed">
        {shouldAnimate ? '' : log.step}
      </span>
      <span className="font-sans text-[10px] text-[var(--muted)] shrink-0 mt-0.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {log.ts}
      </span>
    </motion.li>
  );
}

function LogTab({ logs, isLive, visualResearchPrompt }: LogTabProps) {
  return (
    <div className="space-y-4">
      {logs.length > 0 ? (
        <motion.ul
          className="space-y-3"
          variants={{ show: { transition: { staggerChildren: 0.07 } } }}
          initial="hidden"
          animate="show"
        >
          <AnimatePresence>
            {logs.map((log, i) => (
              <TypewriterEntry key={`${log.ts}-${i}`} log={log} shouldAnimate={isLive} />
            ))}
          </AnimatePresence>
        </motion.ul>
      ) : (
        <p className="font-sans text-[13px] text-[var(--muted)] text-center py-10">
          No log entries yet.
        </p>
      )}

      {/* Visual prompt as cinematic blockquote */}
      {visualResearchPrompt && (
        <div className="mt-4 rounded-xl border border-[var(--gold)]/20 bg-[var(--gold)]/5 px-5 py-4">
          <p className="font-serif text-[10px] uppercase tracking-[0.3em] text-[var(--gold)] mb-2">
            Visual Prompt
          </p>
          <p className="font-serif text-[14px] italic text-[var(--text)]/80 leading-relaxed">
            {'\u201C'}{visualResearchPrompt}{'\u201D'}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────

export function AgentModal({ agentId, agent, sessionId, onClose }: AgentModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>('sources');

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

  // Auto-switch to facts tab when facts arrive
  useEffect(() => {
    if (facts.length > 0 && evaluatedSources.length === 0) setActiveTab('facts');
  }, [facts.length, evaluatedSources.length]);

  // Switch to sources tab when sources arrive
  useEffect(() => {
    if (evaluatedSources.length > 0) setActiveTab('sources');
  }, [evaluatedSources.length]);

  const acceptedCount = evaluatedSources.filter((s) => s.accepted).length;
  const rejectedCount = evaluatedSources.length - acceptedCount;

  const handleClose = useCallback(() => { onClose(); }, [onClose]);

  return (
    <Modal
      open={!!agentId}
      onOpenChange={(open) => { if (!open) handleClose(); }}
      title={agent?.query ?? 'Agent Details'}
      description={undefined}
      className="w-[780px] max-w-[95vw]"
    >
      {/* Header meta row */}
      <div className="flex items-center gap-3 px-6 pb-4 -mt-1">
        <Badge variant={statusBadgeVariant(agent?.status ?? 'queued')}>
          {agent?.status ?? 'queued'}
        </Badge>
        <span className="font-sans text-[10px] text-[var(--muted)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {agent?.elapsed ?? 0}s elapsed
        </span>
        {evaluatedSources.length > 0 && (
          <>
            <span className="text-[var(--bg4)]">·</span>
            <span className="font-sans text-[10px] text-[var(--green)]">{acceptedCount} accepted</span>
            <span className="font-sans text-[10px] text-[var(--muted)]">/</span>
            <span className="font-sans text-[10px] text-red-400">{rejectedCount} rejected</span>
          </>
        )}
      </div>

      {/* Tab bar */}
      <TabBar
        active={activeTab}
        onChange={setActiveTab}
        counts={{ sources: evaluatedSources.length, facts: facts.length, log: logs.length }}
      />

      {/* Tab content */}
      <div className="px-6 py-5 min-h-[280px]">
        <AnimatePresence mode="wait">
          {activeTab === 'sources' && (
            <motion.div
              key="sources"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              {evaluatedSources.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {evaluatedSources.map((src, i) => (
                    <SourceCard key={src.url + i} source={src} index={i} isLive={isLive} />
                  ))}
                  {agent?.status === 'evaluating' && (
                    <>
                      <ShimmerCard />
                      <ShimmerCard />
                    </>
                  )}
                </div>
              ) : agent?.status === 'evaluating' ? (
                <div className="grid grid-cols-2 gap-3">
                  <ShimmerCard />
                  <ShimmerCard />
                  <ShimmerCard />
                  <ShimmerCard />
                </div>
              ) : (
                <p className="font-sans text-[13px] text-[var(--muted)] text-center py-10">
                  {isLive ? 'Fetching sources\u2026' : 'No sources recorded.'}
                </p>
              )}
            </motion.div>
          )}

          {activeTab === 'facts' && (
            <motion.div
              key="facts"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <FactsTab facts={facts} />
            </motion.div>
          )}

          {activeTab === 'log' && (
            <motion.div
              key="log"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
            >
              <LogTab
                logs={logs}
                isLive={isLive}
                visualResearchPrompt={agent?.visualResearchPrompt}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  );
}
