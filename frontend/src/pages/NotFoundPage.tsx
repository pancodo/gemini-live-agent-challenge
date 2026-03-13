import { Link } from 'react-router-dom';
import { motion } from 'motion/react';

export function NotFoundPage() {
  return (
    <main className="h-full flex flex-col items-center justify-center gap-4 bg-[var(--bg)]">
      <motion.div
        className="flex flex-col items-center gap-4"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
      >
        <img src="/logo.png" alt="AI Historian" className="h-12 w-auto opacity-60 mb-2" />

        <span
          className="text-[72px] text-[var(--gold)] opacity-40 leading-none"
          style={{ fontFamily: 'var(--font-serif)', fontWeight: 400 }}
        >
          404
        </span>

        <h1
          className="text-[22px] text-[var(--text)]"
          style={{ fontFamily: 'var(--font-serif)', fontWeight: 400 }}
        >
          Page not found
        </h1>

        <p className="text-[13px] text-[var(--muted)] font-sans text-center">
          The document you were looking for does not exist.
        </p>

        <Link
          to="/"
          className="mt-2 text-[12px] uppercase tracking-[0.1em] text-[var(--gold-d)] font-sans hover:opacity-70 transition-opacity"
        >
          &larr; Back to start
        </Link>
      </motion.div>
    </main>
  );
}
