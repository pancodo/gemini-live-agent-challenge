import { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { BranchNode, Segment } from '../../types';
import { useResearchStore } from '../../store/researchStore';
import { usePlayerStore } from '../../store/playerStore';
import { useGroundingSources } from '../../hooks/useGroundingSources';
import { SourcePanel } from './SourcePanel';

/** Extended player store shape — branchGraph will be added by Team 1. */
interface PlayerStoreWithBranch {
  branchGraph?: BranchNode[];
  [key: string]: unknown;
}

interface PlayerSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function PlayerSidebar({ isOpen, onClose }: PlayerSidebarProps) {
  const segmentsRecord = useResearchStore((s) => s.segments);
  const currentSegmentId = usePlayerStore((s) => s.currentSegmentId);
  const openSegment = usePlayerStore((s) => s.open);
  const branchGraph = usePlayerStore((s) => (s as unknown as PlayerStoreWithBranch).branchGraph ?? []);
  const sources = useGroundingSources();

  const segments: Segment[] = useMemo(
    () => Object.values(segmentsRecord),
    [segmentsRecord],
  );

  const readyCount = useMemo(
    () => segments.filter((s) => s.status === 'ready').length,
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
            background: 'var(--bg-card)',
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

          {/* Segment list */}
          <nav className="flex-1 overflow-y-auto px-3 pb-4" role="list">
            {segments.map((seg, index) => {
              const isActive = seg.id === currentSegmentId;
              const isGenerating = seg.status === 'generating';

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
                            ? '#e8ddd0'
                            : 'rgba(232,221,208,0.5)',
                        }}
                      >
                        {seg.title}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </nav>

          {/* Source panel divider */}
          <div style={{ borderTop: '1px solid rgba(196,149,106,0.08)', margin: '8px 0' }} />

          {/* Grounding evidence panel */}
          <SourcePanel sources={sources} />

          {/* Branch tree divider */}
          <div style={{ borderTop: '1px solid rgba(196,149,106,0.08)', margin: '8px 0' }} />

          {/* BranchTree — populated by branch pipeline via playerStore.branchGraph */}
          {branchGraph.length > 0 && (
            <div className="px-3 pb-3">
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
          <div className="px-5 py-4 border-t" style={{ borderColor: 'rgba(196,149,106,0.1)' }}>
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
