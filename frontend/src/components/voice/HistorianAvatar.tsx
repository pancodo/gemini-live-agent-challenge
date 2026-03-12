import { useRef, useEffect } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { useLive2DModel } from '../../hooks/useLive2DModel';
import { useLipSync } from '../../hooks/useLipSync';
import { useVoiceStore } from '../../store/voiceStore';

const MODEL_PATH = '/models/aldric/chitose.model3.json';

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
        }}
      />
    </div>
  );
}
