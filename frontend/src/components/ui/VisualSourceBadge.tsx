import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';

type VisualSource = 'interleaved' | 'imagen' | 'veo' | 'composing';

interface VisualSourceBadgeProps {
  source: VisualSource;
  /** Compact mode for player overlay (translucent, smaller) */
  compact?: boolean;
  /** Current beat index (0-based) — displayed as 1-based in badge */
  beatIndex?: number;
  /** Total number of beats */
  totalBeats?: number;
}

const CONFIG: Record<VisualSource, { label: string; icon: string; className: string }> = {
  interleaved: {
    label: 'Gemini Composed',
    icon: '✦',
    className: 'interleaved-badge',
  },
  imagen: {
    label: 'Imagen 3',
    icon: '◆',
    className: 'imagen-badge',
  },
  veo: {
    label: 'Veo 2',
    icon: '▶',
    className: 'veo-badge',
  },
  composing: {
    label: 'Composing',
    icon: '⟳',
    className: 'composing-badge',
  },
};

export const VisualSourceBadge = memo(function VisualSourceBadge({
  source,
  compact = false,
  beatIndex,
  totalBeats,
}: VisualSourceBadgeProps) {
  const { label, icon, className } = CONFIG[source];
  const showCounter = beatIndex !== undefined && totalBeats !== undefined && totalBeats > 0;
  const displayLabel = showCounter ? `${label} (${beatIndex + 1}/${totalBeats})` : label;

  if (compact) {
    return (
      <AnimatePresence mode="wait">
        <motion.span
          key={source}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          className={`visual-source-pill visual-source-pill--compact ${className}`}
        >
          <span className="visual-source-pill__icon">{icon}</span>
          <span className="visual-source-pill__label">{displayLabel}</span>
        </motion.span>
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={source}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 350, damping: 24 }}
        className={`visual-source-pill ${className}`}
      >
        <span className="visual-source-pill__icon">{icon}</span>
        <span className="visual-source-pill__label">{displayLabel}</span>
      </motion.span>
    </AnimatePresence>
  );
});
