import { useRef } from 'react';
import { usePlayerStore } from '../../store/playerStore';

/**
 * CaptionTrack — rolling word window synced to Gemini speech.
 *
 * Shows a rolling window of the historian's transcription directly
 * as Gemini delivers it. Words fade in one by one.
 */
const MAX_VISIBLE_WORDS = 16;

export function CaptionTrack() {
  const captionText = usePlayerStore((s) => s.captionText);
  const prevLenRef = useRef(0);

  const words = captionText.trim() ? captionText.trim().split(/\s+/) : [];

  // Reset tracking on new turn (caption gets shorter or empty)
  if (words.length < prevLenRef.current) {
    prevLenRef.current = 0;
  }

  // How many words are new since last render
  const newStart = prevLenRef.current;
  prevLenRef.current = words.length;

  // Rolling window
  const windowStart = Math.max(0, words.length - MAX_VISIBLE_WORDS);
  const visible = words.slice(windowStart);

  const isEmpty = visible.length === 0;

  return (
    <div
      className="flex flex-col items-center rounded-xl"
      style={{
        opacity: isEmpty ? 0 : 1,
        transition: 'opacity 0.3s ease',
        background: 'var(--player-caption-bg)',
        backdropFilter: 'blur(12px)',
        maxWidth: 820,
        margin: '0 auto',
        padding: '12px 24px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <p
        className="text-center leading-relaxed"
        style={{
          maxWidth: 780,
          fontFamily: 'var(--font-serif)',
          fontWeight: 300,
          fontStyle: 'italic',
          fontSize: 26,
          letterSpacing: '0.02em',
          color: 'var(--player-caption-color)',
          textShadow: '0 1px 8px rgba(0,0,0,0.6)',
        }}
      >
        {visible.map((word, i) => {
          const globalIdx = windowStart + i;
          const isNew = globalIdx >= newStart;
          return (
            <span
              key={globalIdx}
              className="inline-block mr-[0.3em]"
              style={{
                opacity: isNew ? 0 : 1,
                animation: isNew ? 'caption-fade-in 0.3s ease forwards' : undefined,
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
