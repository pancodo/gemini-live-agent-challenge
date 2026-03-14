import { useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { usePlayerStore } from '../../store/playerStore';

/**
 * CaptionTrack — sentence-level caption display synced to Gemini speech.
 *
 * Displays one sentence at a time (not a rolling word window). When a
 * sentence boundary is detected, the current sentence fades out and
 * the next fades in fresh. Between beat transitions, captions clear
 * briefly for visual punctuation.
 */

function extractCurrentSentence(text: string): { sentence: string; index: number } {
  if (!text.trim()) return { sentence: '', index: 0 };

  // Split on sentence boundaries
  const sentences = text.match(/[^.!?]+[.!?]+\s*/g);
  if (!sentences || sentences.length === 0) {
    // No complete sentence yet — show the in-progress text
    return { sentence: text.trim(), index: 0 };
  }

  // Show the last complete sentence, or in-progress text after it
  const lastSentence = sentences[sentences.length - 1].trim();
  const afterLastSentence = text.slice(text.lastIndexOf(lastSentence) + lastSentence.length).trim();

  if (afterLastSentence.length > 3) {
    // New sentence in progress — show it
    return { sentence: afterLastSentence, index: sentences.length };
  }

  // Show the last complete sentence
  return { sentence: lastSentence, index: sentences.length - 1 };
}

export function CaptionTrack() {
  const captionText = usePlayerStore((s) => s.captionText);
  const beatTransitioning = usePlayerStore((s) => s.beatTransitioning);
  const prevSentenceRef = useRef('');

  const { sentence, index } = useMemo(
    () => extractCurrentSentence(captionText),
    [captionText],
  );

  // Track previous sentence for fade animation
  const isNewSentence = sentence !== prevSentenceRef.current && sentence.length > 0;
  if (sentence.length > 0) {
    prevSentenceRef.current = sentence;
  }

  const isEmpty = !sentence || beatTransitioning;

  // Split into words for word-by-word reveal
  const words = sentence ? sentence.split(/\s+/) : [];

  return (
    <div
      className="flex flex-col items-center px-6"
      style={{
        opacity: isEmpty ? 0 : 1,
        transition: 'opacity 0.2s ease',
      }}
    >
      {/* Gold horizontal rule — narration indicator */}
      <motion.div
        style={{
          width: '35%',
          height: 1,
          background: 'var(--glow-primary)',
          opacity: 0.4,
          marginBottom: 16,
        }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: isEmpty ? 0 : 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      />

      <AnimatePresence mode="wait">
        <motion.p
          key={`sentence-${index}`}
          className="text-center leading-relaxed"
          style={{
            maxWidth: 800,
            fontFamily: 'var(--font-serif)',
            fontWeight: 300,
            fontStyle: 'italic',
            fontSize: 26,
            letterSpacing: '0.02em',
            color: 'var(--player-text)',
            textShadow: 'var(--player-caption-shadow)',
          }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          {words.map((word, i) => (
            <span
              key={`${index}-${i}`}
              className="inline-block mr-[0.3em]"
              style={{
                opacity: isNewSentence ? 0 : 1,
                animation: isNewSentence ? `caption-fade-in 0.3s ease ${i * 0.04}s forwards` : undefined,
              }}
            >
              {word}
            </span>
          ))}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}
