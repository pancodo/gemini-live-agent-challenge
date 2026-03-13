import { useMemo } from 'react';
import { usePlayerStore } from '../../store/playerStore';

/**
 * CaptionTrack — word-by-word caption reveal synchronized with narrator audio.
 *
 * Each word fades in with a blur-to-clear animation staggered by 0.08s.
 * Uses the `word-appear` keyframe defined in index.css.
 * Captions use Cormorant Garamond 300 italic at 26px with warm text-shadow.
 *
 * The `key` prop on <p> is set to `captionText` directly — React unmounts and
 * remounts the element whenever the text changes, restarting all word animations
 * without needing a separate renderKey state or useEffect.
 */
export function CaptionTrack() {
  const captionText = usePlayerStore((s) => s.captionText);

  const words = useMemo(() => {
    if (!captionText.trim()) return [];
    return captionText.trim().split(/\s+/);
  }, [captionText]);

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
          color: 'var(--text)',
          textShadow:
            '0 2px 28px rgba(0,0,0,0.9), 0 0 80px rgba(0,0,0,0.5)',
        }}
      >
        {words.map((word, i) => (
          <span
            key={`${i}-${word}`}
            className="caption-word inline-block mr-[0.3em]"
            style={{ '--word-delay': `${i * 0.08}s` } as React.CSSProperties}
          >
            {word}
          </span>
        ))}
      </p>
    </div>
  );
}
