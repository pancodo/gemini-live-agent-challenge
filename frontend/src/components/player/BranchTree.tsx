import { motion } from 'motion/react';

import type { BranchNode } from '../../types';

const BRANCH_SPRING = { type: 'spring' as const, stiffness: 400, damping: 25 };

interface BranchTreeProps {
  branches: BranchNode[];
  currentSegmentId: string | null;
  onSelectSegment: (segmentId: string) => void;
}

/**
 * Tree visualization of documentary branches in the PlayerSidebar.
 *
 * Renders only when branches exist. Each branch node shows a gold left-border
 * connector, the trigger question truncated to 2 lines, and highlights the
 * active branch matching the current segment.
 */
export function BranchTree({
  branches,
  currentSegmentId,
  onSelectSegment,
}: BranchTreeProps) {
  if (branches.length === 0) {
    return null;
  }

  return (
    <div className="mt-6">
      {/* Section header — matches PlayerSidebar "Documentary Segments" style */}
      <h3
        className="mb-3 text-[10px] uppercase tracking-[0.4em] font-sans"
        style={{ color: 'var(--gold)', fontFamily: "'DM Sans', sans-serif" }}
      >
        Documentary Branches
      </h3>

      <div className="flex flex-col gap-1.5">
        {branches.map((branch, index) => {
          const isActive = branch.segmentId === currentSegmentId;

          return (
            <motion.button
              key={branch.segmentId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...BRANCH_SPRING, delay: index * 0.05 }}
              onClick={() => onSelectSegment(branch.segmentId)}
              className="group relative flex items-start gap-2 rounded px-2 py-1.5 text-left transition-colors"
              style={{
                borderLeft: isActive
                  ? '2px solid var(--gold)'
                  : '2px solid rgba(139, 94, 26, 0.25)',
                background: isActive
                  ? 'rgba(139, 94, 26, 0.08)'
                  : 'transparent',
              }}
            >
              {/* Depth indicator dot */}
              <span
                className="mt-1.5 shrink-0 rounded-full"
                style={{
                  width: 5,
                  height: 5,
                  backgroundColor: isActive
                    ? 'var(--gold)'
                    : 'rgba(232, 221, 208, 0.3)',
                  marginLeft: branch.depth * 8,
                }}
              />

              {/* Question text — truncated to 2 lines */}
              <span
                className="line-clamp-2 text-[11px] leading-[1.4] font-sans"
                style={{
                  color: isActive
                    ? 'rgba(232, 221, 208, 0.9)'
                    : 'rgba(232, 221, 208, 0.6)',
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                {branch.triggerQuestion}
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
