/**
 * VoiceButton — always-visible voice interaction button.
 *
 * Fixed position bottom-right on all screens except Upload.
 * Five visual states driven by the voice state machine:
 *   idle, listening, processing, historian_speaking, interrupted
 *
 * Integration note: This component should be rendered in App.tsx
 * (outside of route-specific layouts) so it persists across screens.
 * Add to App.tsx after all agents complete:
 *
 *   import { VoiceButton } from './components/voice';
 *
 *   // Inside App component, after <RouterProvider> or alongside routes:
 *   <VoiceButton
 *     voiceState={voiceState}
 *     playbackAnalyser={playbackAnalyser}
 *     onToggle={handleVoiceToggle}
 *   />
 */

import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Spinner } from '../ui/Spinner';
import { Waveform } from './Waveform';
import type { VoiceState } from '../../types';

export interface VoiceButtonProps {
  /** Current voice state from useVoiceState */
  voiceState: VoiceState;
  /** AnalyserNode from playback (historian audio) for waveform ring */
  playbackAnalyser: AnalyserNode | null;
  /** Called when user clicks the button (toggle listening) */
  onToggle: () => void;
}

const SPRING = { stiffness: 400, damping: 17 };

const ARIA_LABELS: Record<VoiceState, string> = {
  idle: 'Start voice conversation with historian',
  listening: 'Listening for your voice. Click to stop.',
  processing: 'Processing your speech',
  historian_speaking: 'Historian is speaking. Click to interrupt.',
  interrupted: 'Historian interrupted',
};

function MicIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke={muted ? 'var(--muted)' : '#c4956a'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
      {muted && <line x1="2" y1="2" x2="22" y2="22" stroke="var(--muted)" />}
    </svg>
  );
}

export function VoiceButton({
  voiceState,
  playbackAnalyser,
  onToggle,
}: VoiceButtonProps) {
  const prefersReducedMotion = useReducedMotion();
  const isActive = voiceState !== 'idle';

  // Ring glow color per state
  const ringColor = (() => {
    switch (voiceState) {
      case 'listening':
        return 'rgba(30, 94, 94, 0.5)'; // teal
      case 'historian_speaking':
        return 'rgba(196, 149, 106, 0.5)'; // gold
      case 'interrupted':
        return 'rgba(180, 60, 60, 0.6)'; // red flash
      default:
        return 'transparent';
    }
  })();

  return (
    <div className="fixed bottom-6 right-6 z-[9000] flex flex-col items-center gap-2">
      {/* Waveform ring — visible when historian is speaking */}
      {voiceState === 'historian_speaking' && (
        <motion.div
          className="absolute -inset-4"
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ type: 'spring', ...SPRING }}
        >
          <Waveform analyser={playbackAnalyser} height={80} />
        </motion.div>
      )}

      {/* Pulse ring — listening state */}
      {voiceState === 'listening' && !prefersReducedMotion && (
        <motion.div
          className="absolute inset-0 rounded-full"
          style={{
            border: '2px solid rgba(30, 94, 94, 0.4)',
          }}
          animate={{ scale: [1, 1.3], opacity: [0.6, 0] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
        />
      )}

      {/* Main button */}
      <motion.button
        type="button"
        onClick={onToggle}
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: 56,
          height: 56,
          border: isActive
            ? `2px solid ${ringColor}`
            : '1px solid rgba(196, 149, 106, 0.3)',
          background: voiceState === 'interrupted'
            ? 'rgba(180, 60, 60, 0.15)'
            : 'var(--bg2)',
          boxShadow: isActive
            ? `0 0 20px ${ringColor}, 0 2px 8px rgba(0,0,0,0.1)`
            : '0 2px 8px rgba(0,0,0,0.08)',
          cursor: voiceState === 'processing' ? 'wait' : 'pointer',
        }}
        whileHover={prefersReducedMotion ? undefined : { scale: 1.02 }}
        whileTap={prefersReducedMotion ? undefined : { scale: 0.97 }}
        transition={{ type: 'spring', ...SPRING }}
        aria-label={ARIA_LABELS[voiceState]}
        aria-busy={voiceState === 'processing'}
        disabled={voiceState === 'processing'}
      >
        <AnimatePresence mode="wait">
          {voiceState === 'processing' ? (
            <motion.div
              key="spinner"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.15 }}
            >
              <Spinner size="sm" />
            </motion.div>
          ) : (
            <motion.div
              key="mic"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.15 }}
            >
              <MicIcon muted={voiceState === 'idle'} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.button>

      {/* State label */}
      <AnimatePresence>
        {voiceState === 'listening' && (
          <motion.span
            className="whitespace-nowrap text-[11px] font-normal uppercase tracking-[0.15em]"
            style={{
              fontFamily: 'var(--font-sans)',
              color: 'var(--teal)',
            }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
          >
            Listening...
          </motion.span>
        )}
        {voiceState === 'historian_speaking' && (
          <motion.span
            className="whitespace-nowrap text-[11px] font-normal uppercase tracking-[0.15em]"
            style={{
              fontFamily: 'var(--font-sans)',
              color: '#c4956a',
            }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
          >
            Speaking
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
