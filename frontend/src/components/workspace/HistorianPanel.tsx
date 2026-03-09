import { motion, useReducedMotion } from 'motion/react';
import { useVoiceStore } from '../../store/voiceStore';
import type { VoiceState } from '../../types';

// ── Voice State Copy ────────────────────────────────────────────

const VOICE_MESSAGES: Record<VoiceState, string> = {
  idle: 'Awaiting your command\u2026',
  listening: 'I\u2019m listening\u2026',
  processing: 'Consulting my sources\u2026',
  historian_speaking: 'Narrating\u2026',
  interrupted: 'Yes, what is it?',
};

function isVoiceActive(state: VoiceState): boolean {
  return state === 'listening' || state === 'historian_speaking' || state === 'interrupted';
}

// ── Component ───────────────────────────────────────────────────

export function HistorianPanel() {
  const voiceState = useVoiceStore((s) => s.state);
  const reducedMotion = useReducedMotion();
  const active = isVoiceActive(voiceState);

  return (
    <div
      className="rounded-lg border border-[var(--bg4)] bg-[var(--bg2)] p-4 relative overflow-hidden"
      style={{
        background: active
          ? 'linear-gradient(135deg, var(--bg2) 0%, rgba(30,94,94,0.08) 100%)'
          : 'var(--bg2)',
        transition: 'background 0.6s ease',
      }}
    >
      {/* Subtle top accent line when active */}
      {active && (
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-[var(--teal)] to-transparent opacity-40" />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[var(--gold)] text-xs">{'\u25C6'}</span>
          <h2 className="font-serif text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]">
            The Historian
          </h2>
        </div>

        {/* Live indicator — right aligned */}
        <div className="flex items-center gap-1.5">
          <motion.div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: active ? 'var(--teal)' : 'var(--muted)' }}
            animate={
              active && !reducedMotion
                ? { scale: [1, 1.4, 1], opacity: [1, 0.5, 1] }
                : { scale: 1, opacity: 1 }
            }
            transition={active ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
          />
          <span className="font-sans text-[10px] uppercase tracking-[0.15em] text-[var(--muted)]">
            {active ? 'Live' : 'Standby'}
          </span>
        </div>
      </div>

      {/* Voice status message */}
      <motion.p
        key={voiceState}
        initial={reducedMotion ? false : { opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="font-serif text-[15px] italic leading-relaxed"
        style={{ color: active ? 'var(--text)' : 'var(--muted)' }}
      >
        &ldquo;{VOICE_MESSAGES[voiceState]}&rdquo;
      </motion.p>
    </div>
  );
}
