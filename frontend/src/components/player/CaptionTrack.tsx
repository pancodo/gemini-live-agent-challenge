import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';

/**
 * CaptionTrack — Rate-limited subtitle display.
 *
 * Gemini's output transcription arrives far ahead of audio (~3s for
 * 30s of speech). This component buffers all received words and
 * releases them at ~3 words/sec to match natural speech pace.
 * Shows the last 20 released words as a Netflix-style subtitle block.
 */
const MAX_VISIBLE_WORDS = 20;
const WORDS_PER_SECOND = 2.8;
const RELEASE_INTERVAL_MS = 1000 / WORDS_PER_SECOND; // ~357ms per word

export function CaptionTrack() {
  const captionText = usePlayerStore((s) => s.captionText);

  // All words received from Gemini (buffer)
  const bufferRef = useRef<string[]>([]);
  // How many words we've released to display so far
  const releasedCountRef = useRef(0);
  // The interval timer
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const [visibleText, setVisibleText] = useState('');

  // Buffer incoming words from Gemini
  useEffect(() => {
    if (!captionText.trim()) {
      // Turn reset — clear everything
      bufferRef.current = [];
      releasedCountRef.current = 0;
      setVisibleText('');
      return;
    }
    bufferRef.current = captionText.trim().split(/\s+/);
  }, [captionText]);

  // Release words at speech pace
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const buffer = bufferRef.current;
      const released = releasedCountRef.current;

      if (released < buffer.length) {
        // Release next word
        releasedCountRef.current = released + 1;
        const end = releasedCountRef.current;
        const start = Math.max(0, end - MAX_VISIBLE_WORDS);
        setVisibleText(buffer.slice(start, end).join(' '));
      }
    }, RELEASE_INTERVAL_MS);

    return () => clearInterval(timerRef.current);
  }, []);

  if (!visibleText) return null;

  return (
    <div
      className="flex flex-col items-center rounded-xl"
      style={{
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
        {visibleText}
      </p>
    </div>
  );
}
