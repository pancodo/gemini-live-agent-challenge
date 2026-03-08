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
    <div className="rounded-lg border border-[var(--bg4)] bg-[var(--bg2)] p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[var(--gold)] text-xs">{'\u25C6'}</span>
        <h2 className="font-serif text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]">
          The Historian
        </h2>
      </div>

      {/* Voice status message */}
      <p className="font-serif text-[14px] italic text-[var(--muted)] mb-3 leading-relaxed">
        &ldquo;{VOICE_MESSAGES[voiceState]}&rdquo;
      </p>

      {/* Voice activity indicator */}
      <div className="flex items-center gap-2">
        <motion.div
          className="w-2 h-2 rounded-full"
          style={{
            backgroundColor: active ? 'var(--teal)' : 'var(--muted)',
          }}
          animate={
            active && !reducedMotion
              ? {
                  scale: [1, 1.4, 1],
                  opacity: [1, 0.6, 1],
                }
              : { scale: 1, opacity: 1 }
          }
          transition={
            active
              ? { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.2 }
          }
        />
        <span className="font-sans text-[10px] uppercase tracking-[0.15em] text-[var(--muted)]">
          {active ? 'Live' : 'Standby'}
        </span>
      </div>
    </div>
  );
}
