import { type FormEvent, type ReactNode, useCallback, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';

const ACCESS_KEY = 'ai-historian-access';
const SPRING = { type: 'spring' as const, stiffness: 400, damping: 17 } as const;

function isAccessGranted(): boolean {
  const envCode = import.meta.env.VITE_ACCESS_CODE as string | undefined;
  // Dev mode: no gate when env var is unset
  if (!envCode) return true;
  return localStorage.getItem(ACCESS_KEY) === envCode;
}

interface AccessGateProps {
  children: ReactNode;
}

export function AccessGate({ children }: AccessGateProps) {
  const [granted, setGranted] = useState(isAccessGranted);
  const [code, setCode] = useState('');
  const [error, setError] = useState(false);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const envCode = import.meta.env.VITE_ACCESS_CODE as string | undefined;
      if (!envCode || code.trim() === envCode) {
        localStorage.setItem(ACCESS_KEY, code.trim());
        setError(false);
        setGranted(true);
      } else {
        setError(true);
        // Reset error after shake animation
        setTimeout(() => setError(false), 600);
      }
    },
    [code],
  );

  if (granted) return <>{children}</>;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.5 }}
        className="flex flex-col items-center gap-8 px-6"
      >
        {/* Logo */}
        <img src="/logo.png" alt="AI Historian" className="h-14" />

        {/* Title */}
        <div className="flex flex-col items-center gap-2 text-center">
          <h1
            className="text-3xl tracking-[0.08em]"
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              color: 'var(--text)',
            }}
          >
            Private Preview
          </h1>
          <p
            className="text-sm"
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 400,
              color: 'var(--muted)',
            }}
          >
            Enter the access code provided in the submission
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4 w-full max-w-xs">
          <motion.div
            animate={error ? { x: [0, -12, 12, -8, 8, -4, 4, 0] } : { x: 0 }}
            transition={error ? { duration: 0.5 } : undefined}
            className="w-full"
          >
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Access code"
              autoFocus
              className="w-full px-4 py-3 rounded-lg text-center text-sm outline-none transition-all duration-200"
              style={{
                fontFamily: 'var(--font-sans)',
                background: 'var(--bg2)',
                color: 'var(--text)',
                border: '1.5px solid var(--bg4)',
                letterSpacing: '0.15em',
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = 'var(--gold)';
                e.currentTarget.style.boxShadow = '0 0 0 3px rgba(139, 94, 26, 0.12)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = 'var(--bg4)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            />
          </motion.div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="text-xs"
                style={{
                  fontFamily: 'var(--font-sans)',
                  color: '#b04040',
                }}
              >
                Invalid access code
              </motion.p>
            )}
          </AnimatePresence>

          <motion.button
            type="submit"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            transition={SPRING}
            className="w-full px-6 py-3 rounded-lg text-sm font-medium tracking-wide cursor-pointer"
            style={{
              fontFamily: 'var(--font-sans)',
              background: 'var(--gold)',
              color: 'var(--bg)',
            }}
          >
            Enter
          </motion.button>
        </form>
      </motion.div>
    </motion.div>
  );
}
