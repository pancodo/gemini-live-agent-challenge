/**
 * Compute normalized audio energy (0..1) from an AnalyserNode.
 * Reused by both the Living Portrait lip sync and useAudioVisualSync.
 */
export function computeAudioEnergy(
  analyser: AnalyserNode,
  buffer: Uint8Array<ArrayBuffer>,
): number {
  analyser.getByteFrequencyData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i];
  }
  return sum / (buffer.length * 255);
}
