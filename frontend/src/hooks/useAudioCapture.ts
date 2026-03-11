import { useCallback, useRef, useState } from 'react';

/**
 * Microphone capture hook producing 16kHz mono PCM Int16 chunks via AudioWorklet.
 *
 * All PCM encoding and downsampling runs off the main thread in a dedicated
 * AudioWorkletProcessor. The worklet handles resampling from the device's
 * native sample rate to 16kHz with linear interpolation and Float32->Int16
 * conversion.
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
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
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

    // Use default sample rate so we get the device's native rate.
    // The worklet handles downsampling to 16kHz internally.
    const ctx = new AudioContext();
    audioContextRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    source.connect(analyser);

    // Load the capture worklet from the static public directory
    await ctx.audioWorklet.addModule('/worklets/pcm-capture.worklet.js');

    const workletNode = new AudioWorkletNode(ctx, 'pcm-capture-processor', {
      processorOptions: { targetSampleRate: 16000 },
    });
    workletNodeRef.current = workletNode;

    workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      onChunkRef.current(new Int16Array(event.data));
    };

    analyser.connect(workletNode);
    // Connect to destination to keep the audio graph alive.
    // The worklet outputs silence (no process output), so nothing plays.
    workletNode.connect(ctx.destination);

    setIsCapturing(true);
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;

    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }

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
