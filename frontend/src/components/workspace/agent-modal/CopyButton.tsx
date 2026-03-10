import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type CopyState = 'idle' | 'copied' | 'error';

export interface CopyButtonProps {
  getText: () => string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: string;
}

export interface FactsCopyButtonProps {
  facts: string[];
}

// ─────────────────────────────────────────────────────────────
// SVG Icons
// ─────────────────────────────────────────────────────────────

function ClipboardIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="4" y="2" width="7" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M4 4H3a1 1 0 00-1 1v6a1 1 0 001 1h6a1 1 0 001-1v-1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckmarkIcon({ size, skipAnimation }: { size: number; skipAnimation: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <motion.path
        d="M2.5 7L5.5 10L11.5 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: skipAnimation ? 1 : 0 }}
        animate={{ pathLength: 1 }}
        transition={skipAnimation ? { duration: 0 } : { duration: 0.25, ease: 'easeOut' }}
      />
    </svg>
  );
}

function XMarkIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M3 3l8 8M11 3L3 11"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// CopyButton
// ─────────────────────────────────────────────────────────────

export function CopyButton({
  getText,
  disabled = false,
  size = 'sm',
  label = 'Copy',
}: CopyButtonProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const reducedMotion = useReducedMotion();

  const iconSize = size === 'sm' ? 14 : 16;

  async function handleCopy() {
    if (disabled || copyState !== 'idle') return;
    try {
      await navigator.clipboard.writeText(getText());
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch {
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  }

  const colorClass =
    copyState === 'copied'
      ? 'text-[var(--green)]'
      : copyState === 'error'
        ? 'text-red-400'
        : 'text-[var(--muted)] hover:text-[var(--text)]';

  const iconVariants = reducedMotion
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.12 },
      }
    : {
        initial: { scale: 0.7, opacity: 0 },
        animate: { scale: 1, opacity: 1 },
        exit: { scale: 0.7, opacity: 0 },
        transition: { type: 'spring' as const, stiffness: 400, damping: 22 },
      };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={disabled}
      aria-label={copyState === 'copied' ? 'Copied!' : copyState === 'error' ? 'Copy failed' : label}
      title={copyState === 'copied' ? 'Copied!' : copyState === 'error' ? 'Copy failed' : label}
      className={`flex items-center justify-center w-7 h-7 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${colorClass}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {copyState === 'idle' && (
          <motion.span
            key="clipboard"
            initial={iconVariants.initial}
            animate={iconVariants.animate}
            exit={iconVariants.exit}
            transition={iconVariants.transition}
            className="flex items-center justify-center"
          >
            <ClipboardIcon size={iconSize} />
          </motion.span>
        )}
        {copyState === 'copied' && (
          <motion.span
            key="check"
            initial={iconVariants.initial}
            animate={iconVariants.animate}
            exit={iconVariants.exit}
            transition={iconVariants.transition}
            className="flex items-center justify-center"
          >
            <CheckmarkIcon size={iconSize} skipAnimation={reducedMotion ?? false} />
          </motion.span>
        )}
        {copyState === 'error' && (
          <motion.span
            key="xmark"
            initial={iconVariants.initial}
            animate={iconVariants.animate}
            exit={iconVariants.exit}
            transition={iconVariants.transition}
            className="flex items-center justify-center"
          >
            <XMarkIcon size={iconSize} />
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// FactsCopyButton — pre-wired for facts list
// ─────────────────────────────────────────────────────────────

export function FactsCopyButton({ facts }: FactsCopyButtonProps) {
  return (
    <CopyButton
      getText={() => facts.map((f, i) => `${i + 1}. ${f}`).join('\n')}
      disabled={facts.length === 0}
      size="sm"
      label="Copy all facts"
    />
  );
}
