import { useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { useVoiceStore } from '../../store/voiceStore';

/**
 * CaptionTrack — audio-synced captions.
 *
 * Measures the actual time between caption updates from Gemini's
 * outputTranscription to dynamically pace word display. Each new
 * transcription fragment tells us how fast the historian is speaking.
 * Words are released at the measured rate, not a fixed constant.
 */
const MAX_VISIBLE_WORDS = 18;
const DEFAULT_WORD_MS = 300;
const MIN_WORD_MS = 150;
const MAX_WORD_MS = 500;

export function CaptionTrack() {
  const captionText = usePlayerStore((s) => s.captionText);
  const voiceState = useVoiceStore((s) => s.state);
  const [displayedWords, setDisplayedWords] = useState<string[]>([]);

  const allWordsRef = useRef<string[]>([]);
  const releasedCountRef = useRef(0);
  const prevCaptionRef = useRef('');

  // Dynamic pacing — track when new words arrive from transcription
  const lastUpdateTimeRef = useRef(0);
  const lastWordCountRef = useRef(0);
  const wordMsRef = useRef(DEFAULT_WORD_MS);

  // When captionText changes, update the word buffer and measure pace
  useEffect(() => {
    if (captionText === prevCaptionRef.current) return;
    prevCaptionRef.current = captionText;

    if (!captionText.trim()) {
      allWordsRef.current = [];
      releasedCountRef.current = 0;
      lastUpdateTimeRef.current = 0;
      lastWordCountRef.current = 0;
      wordMsRef.current = DEFAULT_WORD_MS;
      setDisplayedWords([]);
      return;
    }

    const newWords = captionText.trim().split(/\s+/);
    const now = performance.now();
    const prevCount = allWordsRef.current.length;

    // Measure pace: how many new words arrived and how long since last update
    if (prevCount > 0 && newWords.length > prevCount && lastUpdateTimeRef.current > 0) {
      const elapsed = now - lastUpdateTimeRef.current;
      const addedWords = newWords.length - prevCount;
      if (addedWords > 0 && elapsed > 50) {
        const measuredMs = elapsed / addedWords;
        // Smooth: blend 30% new measurement with 70% previous estimate
        wordMsRef.current = Math.max(MIN_WORD_MS, Math.min(MAX_WORD_MS,
          wordMsRef.current * 0.7 + measuredMs * 0.3
        ));
      }
    }

    lastUpdateTimeRef.current = now;
    allWordsRef.current = newWords;
  }, [captionText]);

  // Adaptive timer — release words at the measured speech rate
  useEffect(() => {
    const tick = () => {
      const all = allWordsRef.current;
      if (releasedCountRef.current < all.length) {
        releasedCountRef.current += 1;
        const start = Math.max(0, releasedCountRef.current - MAX_VISIBLE_WORDS);
        setDisplayedWords(all.slice(start, releasedCountRef.current));
      }
    };

    // Use dynamic interval via recursive setTimeout
    let handle: ReturnType<typeof setTimeout>;
    const schedule = () => {
      handle = setTimeout(() => {
        tick();
        schedule();
      }, wordMsRef.current);
    };
    schedule();

    return () => clearTimeout(handle);
  }, []);

  // Clear when voice stops
  useEffect(() => {
    if (voiceState === 'idle') {
      // Keep displaying last words for a moment, then fade
      const t = setTimeout(() => {
        allWordsRef.current = [];
        releasedCountRef.current = 0;
        setDisplayedWords([]);
      }, 3000);
      return () => clearTimeout(t);
    }
  }, [voiceState]);

  const isEmpty = displayedWords.length === 0;

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
        {displayedWords.map((word, i) => (
          <span key={i} className="inline-block mr-[0.3em]">
            {word}
          </span>
        ))}
      </p>
    </div>
  );
}
