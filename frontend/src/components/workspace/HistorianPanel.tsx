import { useRef, useCallback, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useVoiceStore } from '../../store/voiceStore';
import { LivingPortrait } from '../voice/LivingPortrait';
import type { VoiceState } from '../../types';

// ── Props ────────────────────────────────────────────────────────

interface HistorianPanelProps {
  /** Optional: called when user clicks "Begin Consultation" in standby */
  onSpeak?: () => void;
}

// ── Helpers ──────────────────────────────────────────────────────

const VOICE_MESSAGES: Record<VoiceState, string> = {
  idle: 'Awaiting your command\u2026',
  listening: 'I\u2019m listening\u2026',
  processing: 'Consulting my sources\u2026',
  historian_speaking: 'Narrating\u2026',
  interrupted: 'Yes, what is it?',
  reconnecting: 'Reconnecting\u2026',
};

function isVoiceActive(state: VoiceState): boolean {
  return state === 'listening' || state === 'historian_speaking' || state === 'interrupted';
}

// ── Ornamental Emblem ────────────────────────────────────────────

function HistorianEmblem({ active, voiceState }: { active: boolean; voiceState: VoiceState }) {
  const reducedMotion = useReducedMotion();
  const isSpeaking = voiceState === 'historian_speaking';
  const isListening = voiceState === 'listening';

  const glowColor = isSpeaking
    ? 'rgba(196,149,106,0.35)'
    : isListening
      ? 'rgba(30,94,94,0.35)'
      : active
        ? 'rgba(139,94,26,0.20)'
        : 'rgba(139,94,26,0.08)';

  const strokeColor = active ? 'var(--gold)' : 'var(--muted)';
  const strokeOpacity = active ? 1 : 0.5;

  return (
    <div className="relative flex items-center justify-center">
      {/* Ambient glow layer */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 88,
          height: 88,
          background: `radial-gradient(circle, ${glowColor} 0%, transparent 70%)`,
          filter: 'blur(12px)',
        }}
        animate={{ opacity: active ? 1 : 0.4, scale: active && !reducedMotion ? [1, 1.12, 1] : 1 }}
        transition={active && !reducedMotion ? { duration: 2.8, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.4 }}
      />

      {/* SVG emblem */}
      <motion.svg
        width="64"
        height="64"
        viewBox="0 0 64 64"
        fill="none"
        animate={active && !reducedMotion ? { rotate: [0, 1, -1, 0] } : { rotate: 0 }}
        transition={active ? { duration: 4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
        style={{ position: 'relative' }}
      >
        {/* Outer circle */}
        <circle cx="32" cy="32" r="30" stroke={strokeColor} strokeOpacity={strokeOpacity} strokeWidth="0.75" />

        {/* Inner circle */}
        <circle cx="32" cy="32" r="22" stroke={strokeColor} strokeOpacity={strokeOpacity * 0.6} strokeWidth="0.5" />

        {/* Cardinal lines */}
        <line x1="32" y1="2" x2="32" y2="12" stroke={strokeColor} strokeOpacity={strokeOpacity} strokeWidth="1" strokeLinecap="round" />
        <line x1="32" y1="52" x2="32" y2="62" stroke={strokeColor} strokeOpacity={strokeOpacity} strokeWidth="1" strokeLinecap="round" />
        <line x1="2" y1="32" x2="12" y2="32" stroke={strokeColor} strokeOpacity={strokeOpacity} strokeWidth="1" strokeLinecap="round" />
        <line x1="52" y1="32" x2="62" y2="32" stroke={strokeColor} strokeOpacity={strokeOpacity} strokeWidth="1" strokeLinecap="round" />

        {/* Diagonal ticks */}
        <line x1="8.5" y1="8.5" x2="14.5" y2="14.5" stroke={strokeColor} strokeOpacity={strokeOpacity * 0.5} strokeWidth="0.75" strokeLinecap="round" />
        <line x1="55.5" y1="8.5" x2="49.5" y2="14.5" stroke={strokeColor} strokeOpacity={strokeOpacity * 0.5} strokeWidth="0.75" strokeLinecap="round" />
        <line x1="8.5" y1="55.5" x2="14.5" y2="49.5" stroke={strokeColor} strokeOpacity={strokeOpacity * 0.5} strokeWidth="0.75" strokeLinecap="round" />
        <line x1="55.5" y1="55.5" x2="49.5" y2="49.5" stroke={strokeColor} strokeOpacity={strokeOpacity * 0.5} strokeWidth="0.75" strokeLinecap="round" />

        {/* Central diamond */}
        <path
          d="M32 20 L40 32 L32 44 L24 32 Z"
          stroke={strokeColor}
          strokeOpacity={strokeOpacity}
          strokeWidth="0.75"
          fill={active ? `color-mix(in srgb, ${strokeColor} 8%, transparent)` : 'none'}
        />

        {/* Inner central dot */}
        <motion.circle
          cx="32"
          cy="32"
          r={3}
          fill={active ? 'var(--gold)' : 'var(--muted)'}
          animate={{ fillOpacity: active && !reducedMotion ? [0.9, 0.5, 0.9] : active ? 0.9 : 0.4 }}
          transition={active && !reducedMotion ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
        />

        {/* Cardinal arrowheads */}
        <path d="M32 4 L30.5 8 L32 7 L33.5 8 Z" fill={strokeColor} fillOpacity={strokeOpacity} />
        <path d="M32 60 L30.5 56 L32 57 L33.5 56 Z" fill={strokeColor} fillOpacity={strokeOpacity} />
        <path d="M4 32 L8 30.5 L7 32 L8 33.5 Z" fill={strokeColor} fillOpacity={strokeOpacity} />
        <path d="M60 32 L56 30.5 L57 32 L56 33.5 Z" fill={strokeColor} fillOpacity={strokeOpacity} />
      </motion.svg>

      {/* Listening ring */}
      <AnimatePresence>
        {isListening && !reducedMotion && (
          <motion.div
            key="listen-ring"
            className="absolute rounded-full border"
            style={{ width: 80, height: 80, borderColor: 'rgba(30,94,94,0.5)' }}
            initial={{ scale: 1, opacity: 0.7 }}
            animate={{ scale: 1.4, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      {/* Speaking bars */}
      <AnimatePresence>
        {isSpeaking && !reducedMotion && (
          <motion.div
            key="speak-bars"
            className="absolute flex items-end gap-0.5"
            style={{ bottom: -14, left: '50%', transform: 'translateX(-50%)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            {[0.6, 1.0, 0.75, 1.0, 0.6].map((h, i) => (
              <motion.span
                key={i}
                className="rounded-full"
                style={{ width: 2, backgroundColor: 'var(--gold)' }}
                animate={{ height: [4, 4 + h * 10, 4], opacity: [0.5, 1, 0.5] }}
                transition={{
                  duration: 0.6 + i * 0.07,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: i * 0.12,
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Avatar with Emblem Fallback ───────────────────────────────────

function HistorianAvatarWithFallback({ active, voiceState }: { active: boolean; voiceState: VoiceState }) {
  const [avatarReady, setAvatarReady] = useState(false);

  return (
    <div className="relative flex items-center justify-center" style={{ width: 240, height: 240 }}>
      {/* Living Portrait — always active so it loads eagerly and shows idle animation */}
      <LivingPortrait
        size={160}
        active
        simulateAudio={import.meta.env.DEV}
        onLoad={() => setAvatarReady(true)}
      />

      {/* Emblem fallback — only while avatar is loading */}
      {!avatarReady && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ zIndex: 1 }}>
          <HistorianEmblem active={active} voiceState={voiceState} />
        </div>
      )}
    </div>
  );
}

// ── Ink Ripple button ─────────────────────────────────────────────

function ConsultButton({ onClick }: { onClick?: () => void }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();

  const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!reducedMotion && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const ripple = document.createElement('span');
      ripple.style.cssText = `
        position:absolute; border-radius:50%; pointer-events:none;
        width:8px; height:8px; transform:translate(-50%,-50%) scale(0);
        left:${x}px; top:${y}px;
        background:radial-gradient(circle, rgba(139,94,26,0.5) 0%, transparent 70%);
        animation:ink-ripple 0.55s ease-out forwards;
      `;
      btnRef.current.appendChild(ripple);
      ripple.addEventListener('animationend', () => ripple.remove());
    }
    onClick?.();
  }, [onClick, reducedMotion]);

  return (
    <>
      <style>{`
        @keyframes ink-ripple {
          to { transform: translate(-50%,-50%) scale(24); opacity: 0; }
        }
      `}</style>
      <motion.button
        ref={btnRef}
        type="button"
        onClick={handleClick}
        className="relative overflow-hidden w-full"
        style={{
          fontFamily: 'var(--font-serif)',
          fontWeight: 400,
          fontSize: 11,
          letterSpacing: '0.35em',
          textTransform: 'uppercase',
          color: 'var(--gold)',
          border: '1px solid rgba(139,94,26,0.35)',
          background: 'transparent',
          borderRadius: 4,
          padding: '10px 16px',
          cursor: 'pointer',
        }}
        whileHover={{ borderColor: 'rgba(139,94,26,0.7)', color: 'var(--gold-d)' }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      >
        {/* Corner brackets */}
        <span
          className="absolute top-0 left-0 w-2 h-2 pointer-events-none"
          style={{ borderTop: '1px solid var(--gold)', borderLeft: '1px solid var(--gold)', opacity: 0.5 }}
        />
        <span
          className="absolute top-0 right-0 w-2 h-2 pointer-events-none"
          style={{ borderTop: '1px solid var(--gold)', borderRight: '1px solid var(--gold)', opacity: 0.5 }}
        />
        <span
          className="absolute bottom-0 left-0 w-2 h-2 pointer-events-none"
          style={{ borderBottom: '1px solid var(--gold)', borderLeft: '1px solid var(--gold)', opacity: 0.5 }}
        />
        <span
          className="absolute bottom-0 right-0 w-2 h-2 pointer-events-none"
          style={{ borderBottom: '1px solid var(--gold)', borderRight: '1px solid var(--gold)', opacity: 0.5 }}
        />
        Begin Consultation
      </motion.button>
    </>
  );
}

// ── Component ────────────────────────────────────────────────────

export function HistorianPanel({ onSpeak }: HistorianPanelProps = {}) {
  const voiceState = useVoiceStore((s) => s.state);
  const beginConsultation = useVoiceStore((s) => s.beginConsultation);
  const caption = useVoiceStore((s) => s.caption);
  const userTranscript = useVoiceStore((s) => s.userTranscript);
  const reducedMotion = useReducedMotion();
  const active = isVoiceActive(voiceState);
  const isIdle = voiceState === 'idle';

  const borderColor = active
    ? voiceState === 'historian_speaking'
      ? 'rgba(196,149,106,0.4)'
      : voiceState === 'listening'
        ? 'rgba(30,94,94,0.4)'
        : 'rgba(139,94,26,0.3)'
    : 'var(--bg4)';

  const bgGradient = active
    ? voiceState === 'historian_speaking'
      ? 'linear-gradient(160deg, var(--bg2) 0%, rgba(139,94,26,0.06) 100%)'
      : voiceState === 'listening'
        ? 'linear-gradient(160deg, var(--bg2) 0%, rgba(30,94,94,0.08) 100%)'
        : 'var(--bg2)'
    : 'var(--bg2)';

  return (
    <motion.div
      className="rounded-lg relative overflow-hidden"
      style={{
        border: `1px solid ${borderColor}`,
        background: bgGradient,
        transition: 'border-color 0.5s ease, background 0.6s ease',
      }}
    >
      {/* Top accent line */}
      <AnimatePresence>
        {active && (
          <motion.div
            key="accent"
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background: voiceState === 'historian_speaking'
                ? 'linear-gradient(90deg, transparent, var(--gold), transparent)'
                : 'linear-gradient(90deg, transparent, var(--teal), transparent)',
            }}
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 0.6, scaleX: 1 }}
            exit={{ opacity: 0, scaleX: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      <div className="px-4 pt-3 pb-3 flex flex-col items-center gap-2.5">

        {/* Header row */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <span style={{ color: 'var(--gold)', fontSize: 8, opacity: 0.7 }}>{'\u2666'}</span>
            <h2 className="font-serif text-[10px] uppercase tracking-[0.4em]" style={{ color: 'var(--gold)' }}>
              The Historian
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <motion.div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: active ? (voiceState === 'listening' ? 'var(--teal)' : 'var(--gold)') : 'var(--muted)' }}
              animate={active && !reducedMotion ? { scale: [1, 1.5, 1], opacity: [1, 0.4, 1] } : { scale: 1, opacity: 1 }}
              transition={active ? { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
            />
            <span className="font-sans text-[9px] uppercase tracking-[0.2em]" style={{ color: 'var(--muted)' }}>
              {active ? (voiceState === 'listening' ? 'Listening' : voiceState === 'historian_speaking' ? 'Speaking' : 'Active') : 'Standby'}
            </span>
          </div>
        </div>

        {/* Avatar / Emblem */}
        <HistorianAvatarWithFallback active={active} voiceState={voiceState} />

        {/* Voice status message / live caption */}
        <motion.p
          key={voiceState === 'historian_speaking' && caption ? caption.slice(-60) : voiceState}
          initial={reducedMotion ? false : { opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="font-serif text-[14px] italic leading-relaxed text-center max-h-[4.5em] overflow-hidden"
          style={{ color: active ? 'var(--text)' : 'var(--muted)' }}
        >
          &ldquo;{voiceState === 'historian_speaking' && caption
            ? caption
            : voiceState === 'listening' && userTranscript
              ? userTranscript
              : VOICE_MESSAGES[voiceState]}&rdquo;
        </motion.p>

        {/* CTA button — only in standby */}
        <AnimatePresence mode="wait">
          {isIdle && (
            <motion.div
              key="cta"
              className="w-full"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
            >
              <ConsultButton onClick={onSpeak ?? beginConsultation ?? undefined} />
              <p className="text-center font-sans text-[9px] uppercase tracking-[0.15em] mt-1" style={{ color: 'var(--muted)', opacity: 0.6 }}>
                Voice interaction &middot; Speak freely
              </p>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </motion.div>
  );
}
