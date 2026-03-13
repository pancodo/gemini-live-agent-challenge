import { memo, forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion } from 'motion/react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const BASE =
  'inline-flex items-center justify-center font-sans font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] disabled:opacity-50 disabled:pointer-events-none cursor-pointer';

const VARIANTS = {
  primary: 'bg-[var(--gold)] text-[var(--bg)] hover:bg-[var(--gold-d)]',
  secondary: 'border border-[var(--gold)]/40 bg-transparent text-[var(--gold)] hover:bg-[var(--gold)]/10',
  ghost: 'text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--bg3)]',
} as const;

const SIZES = {
  sm: 'text-xs px-3 py-1.5 rounded',
  md: 'text-sm px-4 py-2 rounded-md',
  lg: 'text-base px-6 py-3 rounded-lg',
} as const;

const SPRING = { type: 'spring' as const, stiffness: 400, damping: 17 } as const;

export const Button = memo(
  forwardRef<HTMLButtonElement, ButtonProps>(
    ({ variant = 'secondary', size = 'md', className = '', children, ...props }, ref) => {
      return (
        <motion.button
          ref={ref}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={SPRING}
          className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
          {...(props as object)}
        >
          {children}
        </motion.button>
      );
    }
  )
);
Button.displayName = 'Button';
