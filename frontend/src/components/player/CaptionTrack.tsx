import { useMemo, useRef, useEffect, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';

/**
 * CaptionTrack — word-by-word caption reveal synchronized with narrator audio.
 *
 * Each word fades in with a blur-to-clear animation staggered by 0.2s.
 * Uses the `word-appear` keyframe defined in index.css.
 * Captions use Cormorant Garamond 300 italic at 26px with warm text-shadow.
 */
export function CaptionTrack() {
  const captionText = usePlayerStore((s) => s.captionText);
  const [renderKey, setRenderKey] = useState(0);
  const previousTextRef = useRef('');

  // Re-trigger animation when captionText changes
  useEffect(() => {
    if (captionText !== previousTextRef.current) {
      previousTextRef.current = captionText;
      setRenderKey((k) => k + 1);
    }
  }, [captionText]);

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
        key={renderKey}
        className="text-center leading-relaxed"
        style={{
          maxWidth: 800,
          fontFamily: 'var(--font-serif)',
          fontWeight: 300,
          fontStyle: 'italic',
          fontSize: 26,
          letterSpacing: '0.02em',
          color: '#e8ddd0',
          textShadow:
            '0 2px 28px rgba(0,0,0,0.9), 0 0 80px rgba(0,0,0,0.5)',
        }}
      >
        {words.map((word, i) => (
          <span
            key={`${renderKey}-${i}`}
            className="inline-block mr-[0.3em]"
            style={{
              opacity: 0,
              animation: 'word-appear 0.4s ease-out forwards',
              animationDelay: `${i * 0.2}s`,
            }}
          >
            {word}
          </span>
        ))}
      </p>
    </div>
  );
}
