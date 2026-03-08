import { useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { motion } from 'motion/react';

interface InkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  className?: string;
}

interface Ripple { id: number; x: number; y: number; }

export function InkButton({ children, className = '', onClick, ...props }: InkButtonProps) {
  const rippleRef = useRef<Ripple[]>([]);
  const containerRef = useRef<HTMLButtonElement>(null);
  const forceUpdate = useRef(0);

  function handleClick(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const id = Date.now();
    rippleRef.current = [...rippleRef.current, { id, x, y }];
    setTimeout(() => {
      rippleRef.current = rippleRef.current.filter((r) => r.id !== id);
      forceUpdate.current++;
    }, 700);
    onClick?.(e);
  }

  return (
    <motion.button
      ref={containerRef}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      onClick={handleClick}
      className={`relative overflow-hidden inline-flex items-center justify-center bg-[var(--gold)] text-[#f5f0e8] font-sans font-medium tracking-wide px-6 py-3 rounded-lg cursor-pointer ${className}`}
      {...(props as object)}
    >
      {children}
      {rippleRef.current.map((r) => (
        <span
          key={r.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            left: r.x,
            top: r.y,
            width: 10,
            height: 10,
            marginLeft: -5,
            marginTop: -5,
            background: 'radial-gradient(circle, rgba(255,255,255,0.4) 0%, transparent 70%)',
            animation: 'ink-spread 0.6s ease-out forwards',
          }}
        />
      ))}
    </motion.button>
  );
}
