import { useRef, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useLive2DModel } from '../../hooks/useLive2DModel';
import { useLipSync } from '../../hooks/useLipSync';
import { useVoiceStore } from '../../store/voiceStore';
import type { VoiceState } from '../../types';

const MODEL_PATH = '/models/aldric/chitose.model3.json';

/** Map voice states to Chitose expression names */
const EXPRESSION_MAP: Partial<Record<VoiceState, string>> = {
  idle: 'Normal.exp3.json',
  listening: 'Smile.exp3.json',
  historian_speaking: 'Normal.exp3.json',
  interrupted: 'Surprised.exp3.json',
  reconnecting: 'Sad.exp3.json',
};

interface HistorianAvatarProps {
  /** Canvas size in CSS pixels (square) */
  size: number;
  /** Additional CSS classes on the outer wrapper */
  className?: string;
  /** When true, triggers lazy loading of the Live2D model */
  active?: boolean;
  /** Called when the Live2D model has loaded successfully */
  onLoad?: () => void;
}

/**
 * HistorianAvatar — Live2D animated character with real-time lip sync.
 *
 * The container div is always mounted so the ref is stable for PixiJS.
 * Opacity is animated to crossfade between loading and loaded states.
 */
export function HistorianAvatar({ size, className, active = false, onLoad }: HistorianAvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const analyserNode = useVoiceStore((s) => s.analyserNode);
  const voiceState = useVoiceStore((s) => s.state);
  const reducedMotion = useReducedMotion();

  const { model, isLoaded, error } = useLive2DModel({
    modelPath: MODEL_PATH,
    containerRef,
    width: size,
    height: size,
    enabled: active,
  });

  useLipSync({
    model,
    analyserNode,
  });

  // Start idle motion when model loads — library auto-loops after first trigger
  useEffect(() => {
    if (!model || !isLoaded) return;
    try { model.motion('Idle', 0); } catch { /* motion not ready */ }
  }, [model, isLoaded]);

  // Map voice state to facial expressions
  useEffect(() => {
    if (!model || !isLoaded) return;
    if (!model.internalModel?.motionManager?.expressionManager) return;
    const expr = EXPRESSION_MAP[voiceState];
    if (expr) {
      try { model.expression(expr); } catch { /* expression not ready */ }
    }
  }, [model, isLoaded, voiceState]);

  // Notify parent when model loads successfully
  useEffect(() => {
    if (isLoaded && !error) {
      onLoad?.();
    }
  }, [isLoaded, error, onLoad]);

  const showCanvas = active && isLoaded && !error;

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        position: 'relative',
      }}
    >
      {/* Container is always mounted so the ref is stable for PixiJS canvas attachment */}
      <motion.div
        ref={containerRef}
        initial={false}
        animate={{
          opacity: showCanvas ? 1 : 0,
          scale: showCanvas ? 1 : (reducedMotion ? 1 : 0.9),
        }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        style={{
          width: size,
          height: size,
          borderRadius: 12,
          overflow: 'hidden',
          position: 'absolute',
          top: 0,
          left: 0,
          filter: 'sepia(0.3) saturate(0.65) contrast(0.9) brightness(0.95) blur(0.7px)',
        }}
      />
    </div>
  );
}
