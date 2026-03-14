import { useMemo, useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';

interface CaptionTrackProps {
  wordsPerSecond?: number;
}

/**
 * CaptionTrack — rolling caption window synchronized with narrator audio.
 *
 * Shows the last ~15 words of the historian's narration as a rolling window.
 * New words fade in with blur animation. Old words are already visible (no replay).
 * This prevents the "all words re-animate" issue when the caption text grows.
 */
const MAX_VISIBLE_WORDS = 15;

export function CaptionTrack({ wordsPerSecond: _wps }: CaptionTrackProps) {
  const captionText = usePlayerStore((s) => s.captionText);
  const prevWordCountRef = useRef(0);

  const words = useMemo(() => {
    if (!captionText.trim()) return [];
    return captionText.trim().split(/\s+/);
  }, [captionText]);

  // Determine which words are "new" (just arrived) vs "old" (already shown)
  const newWordsStart = prevWordCountRef.current;
  // Update ref AFTER computing — so next render knows where old words end
  prevWordCountRef.current = words.length;

  // Show last N words as a rolling window
  const windowStart = Math.max(0, words.length - MAX_VISIBLE_WORDS);
  const visibleWords = words.slice(windowStart);

  const isEmpty = words.length === 0;

  // Reset ref when caption is cleared (new turn)
  if (isEmpty) {
    prevWordCountRef.current = 0;
  }

  return (
    <div
      className="flex justify-center px-6"
      style={{
        opacity: isEmpty ? 0 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <p
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
      >
        {visibleWords.map((word, i) => {
          const globalIndex = windowStart + i;
          const isNew = globalIndex >= newWordsStart;
          return (
            <span
              key={`${globalIndex}-${word}`}
              className="inline-block mr-[0.3em]"
              style={{
                opacity: isNew ? 0 : 1,
                animation: isNew ? 'caption-fade-in 0.4s ease forwards' : undefined,
                animationDelay: isNew ? `${(globalIndex - newWordsStart) * 0.08}s` : undefined,
              }}
            >
              {word}
            </span>
          );
        })}
      </p>
    </div>
  );
}
