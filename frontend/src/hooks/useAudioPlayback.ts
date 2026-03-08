import { useCallback, useRef } from 'react';

/**
 * PCM chunk queue -> continuous Web Audio playback at 24kHz.
 *
 * Schedules AudioBufferSourceNodes ahead of time so chunks play
 * back-to-back with no gaps. Exposes an AnalyserNode for waveform
 * visualization of the historian's voice.
 *
 * Cleanup: stop() halts all active sources and resets the queue.
 */
export function useAudioPlayback() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const nextPlayTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);

  const ensureContext = useCallback(() => {
    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
      const ctx = new AudioContext({ sampleRate: 24000 });
      audioContextRef.current = ctx;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      analyser.connect(ctx.destination);

      nextPlayTimeRef.current = 0;
    }
    return audioContextRef.current;
  }, []);

  const enqueue = useCallback(
    (pcmData: ArrayBuffer) => {
      const ctx = ensureContext();
      const analyser = analyserRef.current;
      if (!analyser) return;

      // Resume context if suspended (autoplay policy)
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      // Convert Int16 PCM to Float32
      const int16 = new Int16Array(pcmData);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      // Create audio buffer
      const buffer = ctx.createBuffer(1, float32.length, 24000);
      buffer.copyToChannel(float32, 0);

      // Schedule playback
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);

      const when = Math.max(ctx.currentTime, nextPlayTimeRef.current);
      source.start(when);
      nextPlayTimeRef.current = when + buffer.duration;

      // Track active source for cleanup
      activeSourcesRef.current.push(source);
      source.onended = () => {
        const idx = activeSourcesRef.current.indexOf(source);
        if (idx !== -1) activeSourcesRef.current.splice(idx, 1);
      };
    },
    [ensureContext],
  );

  const stop = useCallback(() => {
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // Source may have already ended
      }
    }
    activeSourcesRef.current = [];
    nextPlayTimeRef.current = 0;
  }, []);

  const destroy = useCallback(() => {
    stop();
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    analyserRef.current = null;
  }, [stop]);

  return {
    enqueue,
    stop,
    destroy,
    analyser: analyserRef.current,
    /** Access the current analyser ref value (useful when ref updates after first enqueue) */
    getAnalyser: () => analyserRef.current,
  } as const;
}
