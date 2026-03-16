import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';

/**
 * CaptionTrack — Rate-limited subtitle display with chunked refresh.
 *
 * Words release at ~2.2/sec matching speech pace. Instead of shifting
 * on every word (hard to track), text displays in stable chunks of
 * ~12 words that refresh when the chunk is full — like TV subtitles.
 */
const CHUNK_SIZE = 12; // words per subtitle chunk
const WORDS_PER_SECOND = 2.2;
const RELEASE_INTERVAL_MS = 1000 / WORDS_PER_SECOND; // ~455ms per word

export function CaptionTrack() {
  const captionText = usePlayerStore((s) => s.captionText);

  // All words received from Gemini (buffer)
  const bufferRef = useRef<string[]>([]);
  // How many words we've released so far
  const releasedCountRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // Current visible chunk and the growing line within it
  const [chunk, setChunk] = useState('');

  // Buffer incoming words from Gemini
  useEffect(() => {
    if (!captionText.trim()) {
      bufferRef.current = [];
      releasedCountRef.current = 0;
      setChunk('');
      return;
    }
    bufferRef.current = captionText.trim().split(/\s+/);
  }, [captionText]);

  // Release words at speech pace, refresh in chunks
  useEffect(() => {
    timerRef.current = setInterval(() => {
      const buffer = bufferRef.current;
      const released = releasedCountRef.current;

      if (released < buffer.length) {
        releasedCountRef.current = released + 1;
        const count = releasedCountRef.current;

        // Which chunk are we in? Show words from chunk start to current position
        const chunkStart = Math.floor((count - 1) / CHUNK_SIZE) * CHUNK_SIZE;
        const chunkEnd = count;
        setChunk(buffer.slice(chunkStart, chunkEnd).join(' '));
      }
    }, RELEASE_INTERVAL_MS);

    return () => clearInterval(timerRef.current);
  }, []);

  if (!chunk) return null;

  return (
    <div
      className="flex flex-col items-center rounded-xl"
      style={{
        background: 'var(--player-caption-bg)',
        backdropFilter: 'blur(12px)',
        maxWidth: 820,
        margin: '0 auto',
        padding: '14px 28px',
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
        {chunk}
      </p>
    </div>
  );
}
