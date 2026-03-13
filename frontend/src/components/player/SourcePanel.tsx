import { useState, useMemo } from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { motion } from 'motion/react';
import type { GroundingSource } from '../../types';

// ── Helpers ──────────────────────────────────────────────────

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function relevanceBadge(score: number): { label: string; color: string } {
  if (score >= 0.8) return { label: 'High', color: 'var(--green)' };
  if (score >= 0.5) return { label: 'Med', color: 'var(--gold)' };
  return { label: 'Low', color: 'var(--muted)' };
}

// ── Constants ────────────────────────────────────────────────

const MAX_VISIBLE = 6;

const listVariants = {
  visible: {
    transition: { staggerChildren: 0.04 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0 },
};

// ── Component ────────────────────────────────────────────────

interface SourcePanelProps {
  sources: GroundingSource[];
}

export function SourcePanel({ sources }: SourcePanelProps) {
  const [open, setOpen] = useState(true);

  const visible = useMemo(() => sources.slice(0, MAX_VISIBLE), [sources]);
  const overflow = sources.length - MAX_VISIBLE;

  if (sources.length === 0) return null;

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="px-3 pb-3">
      <Collapsible.Trigger asChild>
        <button
          className="flex w-full items-center justify-between py-2 cursor-pointer"
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 10,
            letterSpacing: '0.4em',
            textTransform: 'uppercase',
            color: 'var(--gold)',
          }}
        >
          <span>Verified Sources</span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 200ms ease',
              color: 'var(--gold)',
            }}
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Collapsible.Trigger>

      <Collapsible.Content style={{ overflow: 'hidden' }}>
        <motion.ul
          initial="hidden"
          animate="visible"
          variants={listVariants}
          className="space-y-1"
          style={{ overflow: 'hidden' }}
        >
          {visible.map((src) => {
            const hostname = extractHostname(src.url);
            const badge = relevanceBadge(src.relevanceScore);

            return (
              <motion.li key={src.url} variants={itemVariants}>
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2.5 rounded-md px-2 py-2 transition-colors duration-150"
                  style={{ background: 'transparent' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(196,149,106,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                  }}
                >
                  {/* Favicon */}
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`}
                    alt=""
                    width={16}
                    height={16}
                    className="shrink-0 mt-0.5 rounded-sm"
                  />

                  {/* Text content */}
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate"
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 12,
                        color: 'var(--player-text)',
                        lineHeight: 1.4,
                      }}
                    >
                      {src.title}
                    </p>
                    <p
                      className="truncate"
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 10,
                        color: 'var(--player-text-dim)',
                        lineHeight: 1.5,
                      }}
                    >
                      {hostname}
                    </p>
                  </div>

                  {/* Right column: relevance badge + agent count */}
                  <div className="shrink-0 flex flex-col items-end gap-0.5">
                    <span
                      className="rounded px-1.5 py-0.5"
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 9,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                        color: badge.color,
                        background: `color-mix(in srgb, ${badge.color} 12%, transparent)`,
                      }}
                    >
                      {badge.label}
                    </span>
                    {src.acceptedBy.length > 0 && (
                      <span
                        style={{
                          fontFamily: 'var(--font-sans)',
                          fontSize: 10,
                          color: 'var(--player-text-dim)',
                        }}
                      >
                        x{src.acceptedBy.length} agent{src.acceptedBy.length !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </a>
              </motion.li>
            );
          })}
        </motion.ul>

        {overflow > 0 && (
          <p
            className="px-2 pt-1"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 10,
              color: 'var(--player-text-dim)',
            }}
          >
            + {overflow} more
          </p>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
