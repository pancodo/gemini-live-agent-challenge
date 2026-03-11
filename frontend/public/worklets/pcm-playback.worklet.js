/**
 * PCM Playback AudioWorklet Processor
 *
 * Runs on the audio rendering thread. Receives Float32 PCM chunks from the
 * main thread via MessagePort, queues them, and outputs continuous audio.
 * Flush command clears the queue within one render quantum (~3ms at 24kHz).
 */
class PCMPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    /** @type {Float32Array[]} */
    this._queue = [];
    /** @type {Float32Array | null} */
    this._buffer = null;
    /** @type {number} */
    this._offset = 0;

    this.port.onmessage = (event) => {
      if (event.data.type === 'chunk') {
        this._queue.push(new Float32Array(event.data.samples));
      } else if (event.data.type === 'flush') {
        this._queue = [];
        this._buffer = null;
        this._offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0][0]; // mono output
    if (!output) return true;

    let written = 0;

    while (written < output.length) {
      // Refill from queue if current buffer exhausted
      if (!this._buffer || this._offset >= this._buffer.length) {
        if (this._queue.length === 0) {
          // Underrun: fill remaining with silence
          output.fill(0, written);
          break;
        }
        this._buffer = this._queue.shift();
        this._offset = 0;
      }

      const remaining = output.length - written;
      const available = this._buffer.length - this._offset;
      const toCopy = Math.min(remaining, available);

      output.set(
        this._buffer.subarray(this._offset, this._offset + toCopy),
        written,
      );
      this._offset += toCopy;
      written += toCopy;
    }

    return true; // keep processor alive
  }
}

registerProcessor('pcm-playback-processor', PCMPlaybackProcessor);
