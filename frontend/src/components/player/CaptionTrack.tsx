import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';

/**
 * CaptionTrack — Netflix-style subtitle blocks.
 *
 * Shows Gemini's accumulated transcript as a readable text chunk
 * (like Netflix/YouTube subtitles). No per-word animation — just
 * smooth fade transitions when significant new text arrives.
 */
const MAX_VISIBLE_WORDS = 20;

export function CaptionTrack() {
  const captionText = usePlayerStore((s) => s.captionText);
  const [displayText, setDisplayText] = useState('');
  const [fading, setFading] = useState(false);
  const prevWordCountRef = useRef(0);

  useEffect(() => {
    if (!captionText.trim()) {
      setDisplayText('');
      prevWordCountRef.current = 0;
      return;
    }

    const newWordCount = captionText.trim().split(/\s+/).length;
    const delta = newWordCount - prevWordCountRef.current;
    prevWordCountRef.current = newWordCount;

    // Fade-pulse on large text jump (>4 new words at once)
    if (delta > 4) {
      setFading(true);
      setTimeout(() => {
        setDisplayText(captionText);
        setFading(false);
      }, 120);
    } else {
      setDisplayText(captionText);
    }
  }, [captionText]);

  if (!displayText.trim()) return null;

  const words = displayText.trim().split(/\s+/);
  const visible = words.slice(Math.max(0, words.length - MAX_VISIBLE_WORDS)).join(' ');

  return (
    <div
      className="flex flex-col items-center rounded-xl"
      style={{
        opacity: fading ? 0.3 : 1,
        transition: 'opacity 0.12s ease',
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
          fontSize: 24,
          letterSpacing: '0.02em',
          color: 'var(--player-caption-color)',
          textShadow: '0 1px 8px rgba(0,0,0,0.6)',
        }}
      >
        {visible}
      </p>
    </div>
  );
}
