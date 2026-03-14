import { useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';

/**
 * CaptionTrack — live-synced captions from historian narration.
 *
 * Accumulates transcription fragments from Gemini and displays them
 * as a rolling window. Words appear exactly when the historian says them
 * (no artificial animation delay). Older words scroll out naturally.
 */
const MAX_VISIBLE_WORDS = 18;

export function CaptionTrack() {
  const captionText = usePlayerStore((s) => s.captionText);
  const wordsRef = useRef<string[]>([]);
  const prevTextRef = useRef('');

  // Detect if caption grew (new words appended) or reset (new turn)
  if (captionText !== prevTextRef.current) {
    if (captionText.length > prevTextRef.current.length && captionText.startsWith(prevTextRef.current.slice(0, 20))) {
      // Accumulating — extract new words
      const allWords = captionText.trim().split(/\s+/);
      wordsRef.current = allWords;
    } else if (captionText.length < prevTextRef.current.length || captionText === '') {
      // New turn or reset
      wordsRef.current = captionText.trim() ? captionText.trim().split(/\s+/) : [];
    } else {
      // Different text entirely — replace
      wordsRef.current = captionText.trim() ? captionText.trim().split(/\s+/) : [];
    }
    prevTextRef.current = captionText;
  }

  const allWords = wordsRef.current;
  const windowStart = Math.max(0, allWords.length - MAX_VISIBLE_WORDS);
  const visibleWords = allWords.slice(windowStart);
  const isEmpty = allWords.length === 0;

  return (
    <div
      className="flex justify-center px-6"
      style={{
        opacity: isEmpty ? 0 : 1,
        transition: 'opacity 0.3s ease',
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
        {visibleWords.map((word, i) => (
          <span key={`${windowStart + i}`} className="inline-block mr-[0.3em]">
            {word}
          </span>
        ))}
      </p>
    </div>
  );
}
