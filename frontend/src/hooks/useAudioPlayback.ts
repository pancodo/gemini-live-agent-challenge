import { useCallback, useRef } from 'react';

/**
 * PCM chunk queue -> continuous Web Audio playback at 24kHz via AudioWorklet.
 *
 * Audio processing runs entirely off the main thread in a dedicated
 * AudioWorkletProcessor. The main thread only converts Int16 -> Float32
 * and posts buffers to the worklet via zero-copy transfer.
 *
 * Pre-buffers 3 chunks before starting playback to prevent initial
 * underrun clicks. Flush stops audio within one render quantum (~3ms).
 *
 * Exposes an AnalyserNode for waveform visualization of the historian's voice.
 */

const PLAYBACK_SAMPLE_RATE = 24000;
const PRE_BUFFER_COUNT = 1;

export function useAudioPlayback() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const workletReadyRef = useRef(false);
  const preBufferQueueRef = useRef<Float32Array[]>([]);
  const preBufferSentRef = useRef(false);
  // Pre-allocated scratch buffer — resized only when incoming chunk is larger.
  const scratchRef = useRef<Float32Array | null>(null);

  const ensureContext = useCallback(async () => {
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      return audioContextRef.current;
    }

    const ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
    audioContextRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    analyser.connect(ctx.destination);

    // Load and register the AudioWorklet processor
    await ctx.audioWorklet.addModule('/worklets/pcm-playback.worklet.js');

    const workletNode = new AudioWorkletNode(ctx, 'pcm-playback-processor', {
      outputChannelCount: [1],
    });
    workletNode.connect(analyser);
    workletNodeRef.current = workletNode;
    workletReadyRef.current = true;
    preBufferSentRef.current = false;
    preBufferQueueRef.current = [];

    return ctx;
  }, []);

  const enqueue = useCallback(
    async (pcmData: ArrayBuffer) => {
      const ctx = await ensureContext();
      const workletNode = workletNodeRef.current;
      if (!workletNode) return;

      // Resume context if suspended (autoplay policy)
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }

      // Convert Int16 PCM to Float32 — reuse scratch buffer to avoid allocation per chunk.
      const int16 = new Int16Array(pcmData);
      if (!scratchRef.current || scratchRef.current.length < int16.length) {
        scratchRef.current = new Float32Array(int16.length);
      }
      const float32 = scratchRef.current;
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 32768;
      }

      // Pre-buffer: collect first N chunks before sending any to prevent
      // initial underrun clicks
      if (!preBufferSentRef.current) {
        // Must copy — scratch buffer is reused on next chunk
        preBufferQueueRef.current.push(new Float32Array(float32.subarray(0, int16.length)));
        if (preBufferQueueRef.current.length >= PRE_BUFFER_COUNT) {
          // Flush all pre-buffered chunks to the worklet
          for (const buffered of preBufferQueueRef.current) {
            const copy = buffered.buffer.slice(0);
            workletNode.port.postMessage(
              { type: 'chunk', samples: copy },
              [copy],
            );
          }
          preBufferQueueRef.current = [];
          preBufferSentRef.current = true;
        }
        return;
      }

      // Normal path: copy exact chunk size and transfer to worklet
      const copy = float32.slice(0, int16.length);
      const transferBuffer = copy.buffer;
      workletNode.port.postMessage(
        { type: 'chunk', samples: transferBuffer },
        [transferBuffer],
      );
    },
    [ensureContext],
  );

  const stop = useCallback(() => {
    // Flush worklet queue — clears within one render quantum (~3ms)
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: 'flush' });
    }
    // Reset pre-buffer state for next stream
    preBufferQueueRef.current = [];
    preBufferSentRef.current = false;
  }, []);

  const destroy = useCallback(() => {
    stop();
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    workletReadyRef.current = false;
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    analyserRef.current = null;
  }, [stop]);

  const getAnalyser = useCallback(() => analyserRef.current, []);

  return {
    enqueue,
    stop,
    destroy,
    getAnalyser,
  } as const;
}
