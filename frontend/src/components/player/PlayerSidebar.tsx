import { useMemo, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import type { BranchNode } from '../../types';
import { useResearchStore } from '../../store/researchStore';
import { usePlayerStore } from '../../store/playerStore';
import { useGroundingSources } from '../../hooks/useGroundingSources';
import { SourcePanel } from './SourcePanel';
import { downloadImage } from '../../utils/downloadImage';

const EMPTY_BRANCH: BranchNode[] = [];

interface PlayerSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

// ── Lightbox ─────────────────────────────────────────────────────────────────

interface LightboxProps {
  images: string[];
  initialIndex: number;
  segmentTitle: string;
  onClose: () => void;
}

function Lightbox({ images, initialIndex, segmentTitle, onClose }: LightboxProps) {
  const [index, setIndex] = useState(initialIndex);

  const prev = useCallback(() => setIndex((i) => (i - 1 + images.length) % images.length), [images.length]);
  const next = useCallback(() => setIndex((i) => (i + 1) % images.length), [images.length]);

  const handleDownload = useCallback(() => {
    const url = images[index];
    const filename = `${segmentTitle.replace(/\s+/g, '-').toLowerCase()}-frame-${index + 1}.jpg`;
    void downloadImage(url, filename);
  }, [images, index, segmentTitle]);

  // Keyboard navigation + Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, prev, next]);

  const currentUrl = images[index];

  return (
    <motion.div
      key="lightbox-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.92)' }}
      onClick={onClose}
    >
      {/* Inner panel — stop propagation so clicking the image/controls doesn't close */}
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.94, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="relative flex flex-col items-center"
        style={{ maxWidth: '88vw', maxHeight: '92vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title + counter */}
        <div
          className="w-full flex items-center justify-between mb-3 px-1"
          style={{ gap: 12 }}
        >
          <p
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: 13,
              letterSpacing: '0.05em',
              color: 'rgba(232,221,208,0.9)',
              maxWidth: '70%',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {segmentTitle}
          </p>
          {images.length > 1 && (
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'rgba(232,221,208,0.4)',
              }}
            >
              {index + 1} / {images.length}
            </span>
          )}
        </div>

        {/* Image */}
        <img
          src={currentUrl}
          alt={`${segmentTitle} — frame ${index + 1}`}
          style={{
            maxWidth: '88vw',
            maxHeight: '75vh',
            objectFit: 'contain',
            borderRadius: 4,
            display: 'block',
            boxShadow: '0 8px 64px rgba(0,0,0,0.8)',
          }}
        />

        {/* Navigation arrows */}
        {images.length > 1 && (
          <>
            <button
              onClick={prev}
              aria-label="Previous image"
              className="absolute"
              style={{
                left: -48,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(232,221,208,0.08)',
                border: '1px solid rgba(196,149,106,0.25)',
                color: 'rgba(232,221,208,0.7)',
                fontSize: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              ‹
            </button>
            <button
              onClick={next}
              aria-label="Next image"
              className="absolute"
              style={{
                right: -48,
                top: '50%',
                transform: 'translateY(-50%)',
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: 'rgba(232,221,208,0.08)',
                border: '1px solid rgba(196,149,106,0.25)',
                color: 'rgba(232,221,208,0.7)',
                fontSize: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                transition: 'background 0.15s',
              }}
            >
              ›
            </button>
          </>
        )}

        {/* Action bar */}
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleDownload}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
              background: 'rgba(139,94,26,0.15)',
              border: '1px solid rgba(196,149,106,0.3)',
              borderRadius: 4,
              padding: '6px 14px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'background 0.15s',
            }}
          >
            &#8595; Download
          </button>
          <button
            onClick={onClose}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 11,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: 'rgba(232,221,208,0.45)',
              background: 'rgba(232,221,208,0.05)',
              border: '1px solid rgba(232,221,208,0.1)',
              borderRadius: 4,
              padding: '6px 14px',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
          >
            Close
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Thumbnail strip ───────────────────────────────────────────────────────────

interface ThumbnailStripProps {
  imageUrls: string[];
  segmentTitle: string;
}

function ThumbnailStrip({ imageUrls, segmentTitle }: ThumbnailStripProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const visible = imageUrls.slice(0, 2);

  return (
    <>
      <div
        className="flex gap-1 mt-2"
        style={{ paddingLeft: 22 /* align under title, past the index number */ }}
      >
        {visible.map((url, i) => (
          <button
            key={url}
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex(i);
            }}
            aria-label={`View frame ${i + 1} of ${segmentTitle}`}
            className="shrink-0 overflow-hidden rounded-sm transition-opacity duration-150"
            style={{
              width: 48,
              height: 32,
              padding: 0,
              background: 'rgba(232,221,208,0.06)',
              border: '1px solid rgba(196,149,106,0.2)',
              cursor: 'pointer',
              opacity: 0.75,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '1';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(196,149,106,0.5)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '0.75';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(196,149,106,0.2)';
            }}
          >
            <img
              src={url}
              alt={`Frame ${i + 1}`}
              width={48}
              height={32}
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          </button>
        ))}

        {/* "+N more" badge when there are more than 2 images */}
        {imageUrls.length > 2 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex(2);
            }}
            className="shrink-0 rounded-sm flex items-center justify-center transition-colors duration-150"
            style={{
              width: 48,
              height: 32,
              background: 'rgba(139,94,26,0.12)',
              border: '1px solid rgba(196,149,106,0.2)',
              fontFamily: 'var(--font-sans)',
              fontSize: 9,
              letterSpacing: '0.05em',
              color: 'var(--gold)',
              cursor: 'pointer',
            }}
          >
            +{imageUrls.length - 2}
          </button>
        )}
      </div>

      {lightboxIndex !== null && createPortal(
        <AnimatePresence>
          <Lightbox
            images={imageUrls}
            initialIndex={lightboxIndex}
            segmentTitle={segmentTitle}
            onClose={() => setLightboxIndex(null)}
          />
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

// ── PlayerSidebar ─────────────────────────────────────────────────────────────

export function PlayerSidebar({ isOpen, onClose }: PlayerSidebarProps) {
  const segments = useResearchStore(useShallow((s) => Object.values(s.segments)));
  const currentSegmentId = usePlayerStore((s) => s.currentSegmentId);
  const openSegment = usePlayerStore((s) => s.open);
  const branchGraph = usePlayerStore((s) => s.branchGraph) ?? EMPTY_BRANCH;
  const sources = useGroundingSources();

  const readyCount = useMemo(
    () =>
      segments.filter(
        (s) => s.status === 'ready' || s.status === 'complete' || s.status === 'visual_ready',
      ).length,
    [segments],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.aside
          initial={{ x: 280 }}
          animate={{ x: 0 }}
          exit={{ x: 280 }}
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          className="fixed top-0 right-0 h-full z-30 flex flex-col"
          style={{
            width: 280,
            background: 'var(--bg2)',
            backdropFilter: 'blur(16px)',
            borderLeft: '1px solid rgba(196,149,106,0.15)',
          }}
        >
          {/* Header */}
          <div className="px-5 pt-6 pb-4">
            <h2
              className="mb-1"
              style={{
                fontFamily: 'var(--font-serif)',
                fontWeight: 400,
                fontSize: 10,
                letterSpacing: '0.4em',
                textTransform: 'uppercase',
                color: 'var(--gold)',
              }}
            >
              Documentary Segments
            </h2>
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: 11,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'rgba(232,221,208,0.5)',
              }}
            >
              {readyCount} segment{readyCount !== 1 ? 's' : ''} ready
            </p>
          </div>

          {/* Segment list — flex-1 with min-h-0 so it can shrink below its content height */}
          <nav className="flex-1 min-h-0 overflow-y-auto px-3 pb-4" role="list">
            {segments.map((seg, index) => {
              const isActive = seg.id === currentSegmentId;
              const isGenerating = seg.status === 'generating';
              const hasThumbnails = !isGenerating && seg.imageUrls.length > 0;

              return (
                <button
                  key={seg.id}
                  role="listitem"
                  onClick={() => {
                    if (!isGenerating) {
                      openSegment(seg.id);
                    }
                  }}
                  disabled={isGenerating}
                  className="w-full text-left rounded-md mb-1 px-3 py-3 transition-colors duration-200"
                  style={{
                    background: isActive
                      ? 'rgba(139,94,26,0.12)'
                      : 'transparent',
                    borderLeft: isActive
                      ? '2px solid var(--gold)'
                      : '2px solid transparent',
                    cursor: isGenerating ? 'default' : 'pointer',
                  }}
                >
                  <div className="flex items-start gap-2">
                    {/* Index */}
                    <span
                      className="shrink-0 mt-px"
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontWeight: 400,
                        fontSize: 11,
                        letterSpacing: '0.1em',
                        color: isActive
                          ? 'var(--gold)'
                          : 'rgba(232,221,208,0.35)',
                      }}
                    >
                      {String(index + 1).padStart(2, '0')}
                    </span>

                    {/* Title or skeleton */}
                    {isGenerating ? (
                      <span
                        className="block h-3 rounded-sm mt-1"
                        style={{
                          width: '70%',
                          background:
                            'linear-gradient(90deg, rgba(232,221,208,0.08) 25%, rgba(232,221,208,0.15) 50%, rgba(232,221,208,0.08) 75%)',
                          backgroundSize: '200% 100%',
                          animation: 'shimmer 1.5s ease-in-out infinite',
                        }}
                      />
                    ) : (
                      <span
                        style={{
                          fontFamily: 'var(--font-serif)',
                          fontWeight: 400,
                          fontSize: 14,
                          lineHeight: 1.4,
                          color: isActive
                            ? 'var(--text)'
                            : 'rgba(232,221,208,0.5)',
                        }}
                      >
                        {seg.title}
                      </span>
                    )}
                  </div>

                  {/* Thumbnail strip — renders below title row */}
                  {hasThumbnails && (
                    <ThumbnailStrip
                      imageUrls={seg.imageUrls}
                      segmentTitle={seg.title}
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Source panel divider */}
          <div className="shrink-0" style={{ borderTop: '1px solid rgba(196,149,106,0.08)', margin: '8px 0' }} />

          {/* Grounding evidence panel */}
          <div className="shrink-0">
            <SourcePanel sources={sources} />
          </div>

          {/* Branch tree divider */}
          <div className="shrink-0" style={{ borderTop: '1px solid rgba(196,149,106,0.08)', margin: '8px 0' }} />

          {/* BranchTree — populated by branch pipeline via playerStore.branchGraph */}
          {branchGraph.length > 0 && (
            <div className="shrink-0 px-3 pb-3">
              {/* BranchTree component will be imported when available */}
              <p style={{ fontFamily: 'var(--font-sans)', fontSize: 10, letterSpacing: '0.4em', textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 8 }}>
                Documentary Branches
              </p>
              {branchGraph.map((node) => (
                <button
                  key={node.segmentId}
                  onClick={() => openSegment(node.segmentId)}
                  className="w-full text-left px-2 py-2 rounded mb-1"
                  style={{ fontSize: 11, color: 'rgba(232,221,208,0.6)', fontFamily: 'var(--font-sans)', background: 'transparent', borderLeft: '2px solid rgba(196,149,106,0.3)' }}
                >
                  {'\u21B3'} {node.triggerQuestion}
                </button>
              ))}
            </div>
          )}

          {/* Close button */}
          <div className="shrink-0 px-5 py-4 border-t" style={{ borderColor: 'rgba(196,149,106,0.1)' }}>
            <button
              onClick={onClose}
              className="w-full py-2 rounded-md text-center transition-colors duration-200"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: 11,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'rgba(232,221,208,0.5)',
                background: 'rgba(232,221,208,0.05)',
              }}
            >
              Close
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
