import { memo } from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'gold' | 'teal' | 'green' | 'muted' | 'red';
}

const VARIANTS = {
  gold: 'bg-[var(--gold)]/15 text-[var(--gold)] border-[var(--gold)]/30',
  teal: 'bg-[var(--teal)]/15 text-[var(--teal)] border-[var(--teal)]/30',
  green: 'bg-[var(--green)]/15 text-[var(--green)] border-[var(--green)]/30',
  muted: 'bg-[var(--bg3)] text-[var(--muted)] border-[var(--bg4)]',
  red: 'bg-red-500/15 text-red-600 border-red-500/30',
} as const;

export const Badge = memo(function Badge({ children, variant = 'muted' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] rounded border font-sans ${VARIANTS[variant]}`}
    >
      {children}
    </span>
  );
});
