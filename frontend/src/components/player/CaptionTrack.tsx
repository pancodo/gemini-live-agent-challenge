import { useMemo } from 'react';
import { usePlayerStore } from '../../store/playerStore';

interface CaptionTrackProps {
  wordsPerSecond?: number;
}

/**
 * CaptionTrack — word-by-word caption reveal synchronized with narrator audio.
 *
 * Each word fades in with a blur-to-clear animation staggered by a computed delay.
 * Uses the `word-appear` keyframe defined in index.css.
 * Captions use Cormorant Garamond 300 italic at 26px with warm text-shadow.
 *
 * When `wordsPerSecond` is provided, the stagger is computed as
 * `1000 / (wps * words.length)` ms per word, clamped between 30ms and 120ms.
 * When unavailable, a 60ms default is used.
 *
 * The `key` prop on <p> is set to `captionText` directly — React unmounts and
 * remounts the element whenever the text changes, restarting all word animations
 * without needing a separate renderKey state or useEffect.
 */
export function CaptionTrack({ wordsPerSecond }: CaptionTrackProps) {
  const captionText = usePlayerStore((s) => s.captionText);

  const words = useMemo(() => {
    if (!captionText.trim()) return [];
    return captionText.trim().split(/\s+/);
  }, [captionText]);

  const staggerMs = useMemo(() => {
    if (wordsPerSecond && wordsPerSecond > 0 && words.length > 0) {
      const raw = 1000 / (wordsPerSecond * words.length);
      return Math.max(30, Math.min(120, raw));
    }
    return 60;
  }, [wordsPerSecond, words.length]);

  const isEmpty = words.length === 0;

  return (
    <div
      className="flex justify-center px-6"
      style={{
        opacity: isEmpty ? 0 : 1,
        transition: 'opacity 0.4s ease',
      }}
    >
      <p
        key={captionText}
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
        {words.map((word, i) => (
          <span
            key={`${i}-${word}`}
            className="caption-word inline-block mr-[0.3em]"
            style={{ '--word-delay': `${i * staggerMs / 1000}s` } as React.CSSProperties}
          >
            {word}
          </span>
        ))}
      </p>
    </div>
  );
}
