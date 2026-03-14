import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';

/**
 * CaptionTrack — delayed captions synced to audio playback.
 *
 * Gemini's outputTranscription arrives faster than audio playback.
 * This component buffers incoming caption text and releases words
 * with a delay to approximately match the historian's speech rate.
 */
const MAX_VISIBLE_WORDS = 18;
const WORD_RELEASE_MS = 350; // ~2.8 words per second (natural speech pace)

export function CaptionTrack() {
  const captionText = usePlayerStore((s) => s.captionText);
  const [displayedWords, setDisplayedWords] = useState<string[]>([]);
  const allWordsRef = useRef<string[]>([]);
  const releasedCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const prevCaptionRef = useRef('');

  // When captionText changes, update the word buffer
  useEffect(() => {
    if (captionText === prevCaptionRef.current) return;
    prevCaptionRef.current = captionText;

    if (!captionText.trim()) {
      // Caption cleared — new turn
      allWordsRef.current = [];
      releasedCountRef.current = 0;
      setDisplayedWords([]);
      return;
    }

    allWordsRef.current = captionText.trim().split(/\s+/);
  }, [captionText]);

  // Timer to release words gradually
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const all = allWordsRef.current;
      if (releasedCountRef.current < all.length) {
        releasedCountRef.current += 1;
        const start = Math.max(0, releasedCountRef.current - MAX_VISIBLE_WORDS);
        setDisplayedWords(all.slice(start, releasedCountRef.current));
      }
    }, WORD_RELEASE_MS);

    return () => clearInterval(timerRef.current);
  }, []);

  const isEmpty = displayedWords.length === 0;

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
        {displayedWords.map((word, i) => (
          <span key={i} className="inline-block mr-[0.3em]">
            {word}
          </span>
        ))}
      </p>
    </div>
  );
}
