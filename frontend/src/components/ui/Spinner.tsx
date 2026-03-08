import { motion } from 'motion/react';

interface SpinnerProps { size?: 'sm' | 'md' | 'lg'; }

export function Spinner({ size = 'md' }: SpinnerProps) {
  const sizes = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' };
  return (
    <motion.div
      className={`${sizes[size]} rounded-full border-2 border-[var(--bg4)] border-t-[var(--gold)]`}
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
    />
  );
}
