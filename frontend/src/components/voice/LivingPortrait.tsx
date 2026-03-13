import { useRef, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { usePortraitRenderer } from '../../hooks/usePortraitRenderer';
import { useVoiceStore } from '../../store/voiceStore';
import type { PortraitEra } from '../../types';
import './LivingPortrait.css';

interface LivingPortraitProps {
  /** Canvas size in CSS pixels (square) */
  size: number;
  /** Additional CSS classes on the outer wrapper */
  className?: string;
  /** When true, starts loading and rendering the portrait */
  active?: boolean;
  /** Called when the portrait images have loaded */
  onLoad?: () => void;
  /** Portrait era — controls costume. Defaults to 'default' */
  era?: PortraitEra;
  /** Dev mode: simulate audio for testing lip sync without backend */
  simulateAudio?: boolean;
}

const breathingVariants = {
  breathing: {
    y: [0, -1.5, 0],
    scale: [1, 1.005, 1],
    transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' as const },
  },
  still: { y: 0, scale: 1 },
};

export function LivingPortrait({
  size,
  className,
  active = false,
  onLoad,
  era = 'default',
  simulateAudio = false,
}: LivingPortraitProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const analyserNode = useVoiceStore((s) => s.analyserNode);
  const voiceState = useVoiceStore((s) => s.state);
  const reducedMotion = useReducedMotion();

  const { isLoaded } = usePortraitRenderer({
    canvasRef,
    era,
    size,
    analyserNode,
    active,
    simulateAudio,
  });

  // Notify parent when loaded (ref pattern avoids re-firing on unstable callbacks)
  useEffect(() => {
    if (isLoaded) onLoadRef.current?.();
  }, [isLoaded]);

  const isSpeaking = voiceState === 'historian_speaking';
  const isListening = voiceState === 'listening';

  const stateClass = isSpeaking ? 'portrait-glow' : isListening ? 'portrait-listening' : '';

  return (
    <div
      className={className}
      style={{ width: size, height: size, position: 'relative' }}
    >
      <motion.div
        initial={false}
        animate={{
          opacity: active && isLoaded ? 1 : 0,
          scale: active && isLoaded ? 1 : (reducedMotion ? 1 : 0.95),
        }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <motion.div
          className={`portrait-container ${stateClass}`}
          variants={breathingVariants}
          animate={active && !reducedMotion ? 'breathing' : 'still'}
          style={{ width: size, height: size }}
        >
          <canvas
            ref={canvasRef}
            className="portrait-canvas"
            role="img"
            aria-label="AI Historian portrait"
            style={{ width: size, height: size }}
          />
          {/* Vignette — soft darkened edges */}
          <div className="portrait-vignette" />
          {/* Gold ornamental frame */}
          <div className="portrait-frame" />
        </motion.div>
      </motion.div>
    </div>
  );
}
