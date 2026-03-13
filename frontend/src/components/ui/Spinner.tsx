import { memo } from 'react';
import { motion } from 'motion/react';

interface SpinnerProps { size?: 'sm' | 'md' | 'lg'; }

const SIZE_CLASSES = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' } as const;
const SPINNER_TRANSITION = { duration: 0.8, repeat: Infinity, ease: 'linear' } as const;

export const Spinner = memo(function Spinner({ size = 'md' }: SpinnerProps) {
  return (
    <motion.div
      className={`${SIZE_CLASSES[size]} rounded-full border-2 border-[var(--bg4)] border-t-[var(--gold)]`}
      animate={{ rotate: 360 }}
      transition={SPINNER_TRANSITION}
    />
  );
});
