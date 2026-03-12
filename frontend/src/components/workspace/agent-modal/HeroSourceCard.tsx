import { useState, type MouseEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { getUrlMeta } from '../../../services/api';
import type { EvaluatedSource, UrlMeta } from '../../../types';

// ─────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────

export interface HeroSourceCardProps {
  source: EvaluatedSource;
  isLive: boolean;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function extractHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
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
// Hero Download Button
// ─────────────────────────────────────────────────────────────

function HeroImageDownloadButton({ imageUrl, filename }: { imageUrl: string; filename: string }) {
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
      className="absolute bottom-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white/80 hover:bg-black/80 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-auto font-sans text-[10px] uppercase tracking-[0.1em]"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M6 1v6.5M3 5l3 3 3-3M1.5 10h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Save
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Hero OG Image Zone — 220px tall (vs 140px on SourceCard)
// ─────────────────────────────────────────────────────────────

function HeroOgImageZone({
  imageUrl,
  hostname,
  isLoading,
}: {
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
    <div className="group relative w-full h-[220px] overflow-hidden bg-[var(--bg3)] rounded-t-xl">
      {/* Shimmer skeleton while loading */}
      {showSkeleton && (
        <div className="absolute inset-0 log-source evaluating" />
      )}

      {/* Actual OG image */}
      {showImage && (
        <img
          src={imageUrl}
          alt={hostname}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setImageLoaded(true)}
          onError={() => { setImgError(true); setImageLoaded(false); }}
        />
      )}

      {/* Fallback: large first-letter monogram */}
      {showFallback && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, var(--bg3) 0%, var(--bg4) 100%)' }}
        >
          <span
            className="font-serif leading-none select-none"
            style={{ fontSize: '72px', color: 'var(--gold)', opacity: 0.25 }}
          >
            {hostname[0]?.toUpperCase() ?? '?'}
          </span>
        </div>
      )}

      {/* Bottom gradient overlay for text legibility (same as SourceCard OgImageZone) */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.32) 100%)' }}
      />

      {/* Download button — appears on hover */}
      {showImage && imageLoaded && (
        <HeroImageDownloadButton imageUrl={imageUrl} filename={`${hostname}-featured.jpg`} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// HeroSourceCard
// ─────────────────────────────────────────────────────────────

export function HeroSourceCard({ source, isLive }: HeroSourceCardProps) {
  const [faviconError, setFaviconError] = useState(false);
  const reducedMotion = useReducedMotion();

  const host = extractHostname(source.url);
  const needsMeta = !source.imageUrl;
  const { data: meta, isLoading: metaLoading } = useUrlMeta(source.url, needsMeta);

  const imageUrl = source.imageUrl ?? meta?.image ?? null;
  const title = source.title ?? meta?.title ?? host;
  const description = source.description ?? meta?.description ?? null;
  const favicon =
    source.favicon ??
    meta?.favicon ??
    `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  const isImageLoading = needsMeta && metaLoading;

  // Entrance animation — respect prefers-reduced-motion:
  // full spring entrance when motion is allowed, opacity-only when reduced.
  const motionProps = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        transition: { type: 'spring' as const, stiffness: 320, damping: 26 },
      };

  return (
    <motion.article
      {...motionProps}
      aria-label={`Featured source: ${title}`}
      className="relative flex flex-col w-full rounded-xl border border-[var(--green)]/30 bg-[var(--bg)]/70 overflow-hidden shadow-md hover:shadow-lg transition-shadow"
    >
      {/* ── Hero OG Image ── */}
      <HeroOgImageZone
        imageUrl={imageUrl}
        hostname={host}
        isLoading={isImageLoading || isLive}
      />

      {/* ── Top-left badge: Accepted (frosted glass) ── */}
      <div
        className="absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 rounded-full z-10 font-sans text-[10px] uppercase tracking-[0.15em] text-white"
        style={{
          background: 'rgba(46, 110, 68, 0.82)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
        }}
      >
        <span>✓</span>
        <span>Accepted</span>
      </div>

      {/* ── Top-right label: FEATURED SOURCE ── */}
      <div className="absolute top-3 right-3 z-10">
        <span
          className="font-serif uppercase tracking-[0.3em] text-white/80"
          style={{ fontSize: '9px', letterSpacing: '0.3em', textShadow: '0 1px 6px rgba(0,0,0,0.6)' }}
        >
          Featured Source
        </span>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-col gap-2 px-4 py-3">
        {/* Favicon + domain row */}
        <div className="flex items-center gap-2">
          {!faviconError ? (
            <img
              src={favicon}
              alt=""
              width={16}
              height={16}
              className="rounded-sm shrink-0"
              onError={() => setFaviconError(true)}
            />
          ) : (
            <span className="w-4 h-4 rounded-sm bg-[var(--bg4)] shrink-0 flex items-center justify-center font-sans text-[9px] text-[var(--muted)]">
              {host[0]?.toUpperCase()}
            </span>
          )}
          <span className="font-sans text-[11px] text-[var(--muted)] truncate">{host}</span>
        </div>

        {/* Serif title — 16px, 2 lines max */}
        <h3 className="font-serif text-[16px] font-normal text-[var(--text)] leading-snug line-clamp-2">
          {title}
        </h3>

        {/* Description — up to 3 lines */}
        {description && (
          <p className="font-sans text-[12px] text-[var(--muted)] leading-relaxed line-clamp-3">
            {description}
          </p>
        )}

        {/* Reason as blockquote — gold left border */}
        {source.reason && (
          <blockquote className="border-l-2 border-[var(--gold)]/50 pl-3 my-0.5">
            <p className="font-serif text-[13px] italic text-[var(--text)]/65 leading-relaxed line-clamp-4">
              {'\u201C'}{source.reason}{'\u201D'}
            </p>
          </blockquote>
        )}

        {/* Visit link */}
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 font-sans text-[11px] text-[var(--gold)] hover:underline self-start mt-1"
        >
          Visit ↗
        </a>
      </div>
    </motion.article>
  );
}
