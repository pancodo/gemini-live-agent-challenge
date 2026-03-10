import { useEffect } from 'react';
import { motion, useSpring, useTransform, useReducedMotion } from 'motion/react';
import type { MotionValue } from 'motion/react';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface AnimatedCountProps {
  value: number;
  className?: string;
}

// ─────────────────────────────────────────────────────────────
// Hook — useCountUp
// Expose the spring MotionValue for callers that need it raw
// (e.g. feeding into a useTransform chain).
// ─────────────────────────────────────────────────────────────

export function useCountUp(value: number): MotionValue<string> {
  const spring = useSpring(0, { stiffness: 80, damping: 18, mass: 0.8 });
  const display = useTransform(spring, (v) => Math.round(v).toString());

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  return display;
}

// ─────────────────────────────────────────────────────────────
// Component — AnimatedCount
// Counts up from 0 to `value` on mount and on value changes.
// When the parent drawer remounts (agentId swap), the component
// remounts too — spring resets to 0 automatically.
// ─────────────────────────────────────────────────────────────

export function AnimatedCount({ value, className }: AnimatedCountProps) {
  const reducedMotion = useReducedMotion();
  const spring = useSpring(0, { stiffness: 80, damping: 18, mass: 0.8 });
  const display = useTransform(spring, (v) => Math.round(v).toString());

  useEffect(() => {
    spring.set(value);
  }, [value, spring]);

  if (reducedMotion) {
    return <span className={className}>{value}</span>;
  }

  return (
    <motion.span className={className} style={{ display: 'inline-block' }}>
      {display}
    </motion.span>
  );
}
