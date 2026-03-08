import { useCallback, useRef, useState } from 'react';

// AudioWorklet processor code — converts Float32 mic input to Int16 PCM
const WORKLET_CODE = `
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const pcm = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
`;

/**
 * Microphone capture hook producing 16kHz mono PCM Int16 chunks.
 *
 * Returns an AnalyserNode for waveform visualization and a start/stop API.
 * The onChunk callback fires with each PCM chunk from the AudioWorklet.
 *
 * Cleanup: stop() closes AudioContext and stops all MediaStream tracks.
 */
export function useAudioCapture(onChunk: (pcm: Int16Array) => void) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const onChunkRef = useRef(onChunk);
  onChunkRef.current = onChunk;

  const [isCapturing, setIsCapturing] = useState(false);

  const start = useCallback(async () => {
    if (audioContextRef.current) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
      },
    });

    streamRef.current = stream;

    const ctx = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    source.connect(analyser);

    // Try AudioWorklet, fall back to ScriptProcessorNode
    try {
      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const workletNode = new AudioWorkletNode(ctx, 'pcm-processor');
      workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        onChunkRef.current(new Int16Array(event.data));
      };
      analyser.connect(workletNode);
      workletNode.connect(ctx.destination);
    } catch {
      // Fallback: ScriptProcessorNode (deprecated but widely supported)
      const processor = ctx.createScriptProcessor(1024, 1, 1);
      processor.onaudioprocess = (event: AudioProcessingEvent) => {
        const input = event.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          pcm[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
        }
        onChunkRef.current(pcm);
      };
      analyser.connect(processor);
      processor.connect(ctx.destination);
    }

    setIsCapturing(true);
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setIsCapturing(false);
  }, []);

  return {
    start,
    stop,
    analyser: analyserRef.current,
    isCapturing,
  } as const;
}
