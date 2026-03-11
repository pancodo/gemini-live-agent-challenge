/**
 * PCM Capture AudioWorklet Processor
 *
 * Runs on the audio rendering thread. Receives Float32 mic samples from the
 * Web Audio graph, downsamples from the source sample rate to the target rate
 * (default 16kHz), converts to Int16 PCM, and posts the buffer back to the
 * main thread via zero-copy transfer.
 */
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._targetRate =
      options.processorOptions?.targetSampleRate ?? 16000;
    // `sampleRate` is a global in AudioWorkletGlobalScope
    this._sourceRate = sampleRate;
    this._ratio = this._sourceRate / this._targetRate;
    /** @type {number[]} */
    this._inputBuffer = [];
    this._fractionalPos = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0]; // mono mic
    if (!input || input.length === 0) return true;

    // Accumulate input samples
    for (let i = 0; i < input.length; i++) {
      this._inputBuffer.push(input[i]);
    }

    // Downsample with linear interpolation
    const outputSamples = [];
    while (this._fractionalPos + 1 < this._inputBuffer.length) {
      const idx = Math.floor(this._fractionalPos);
      const frac = this._fractionalPos - idx;
      const x0 = this._inputBuffer[idx];
      const x1 = this._inputBuffer[idx + 1];
      outputSamples.push(x0 + (x1 - x0) * frac);
      this._fractionalPos += this._ratio;
    }

    // Remove consumed samples, keeping any remainder for next call
    const consumed = Math.floor(this._fractionalPos);
    this._inputBuffer.splice(0, consumed);
    this._fractionalPos -= consumed;

    if (outputSamples.length === 0) return true;

    // Convert Float32 to Int16 PCM
    const int16 = new Int16Array(outputSamples.length);
    for (let i = 0; i < outputSamples.length; i++) {
      const s = Math.max(-1, Math.min(1, outputSamples[i]));
      int16[i] = s < 0 ? s * 32768 : s * 32767;
    }

    // Zero-copy transfer to main thread
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true;
  }
}

registerProcessor('pcm-capture-processor', PCMCaptureProcessor);
