import { useEffect, useRef } from 'react';

/**
 * Reads AnalyserNode frequency data each rAF frame and drives
 * CSS custom properties on :root for audio-reactive visuals.
 *
 * Driven properties:
 *   --ken-speed:    28s (silence) -> 20s (peak)
 *   --glow-opacity: 0.5 -> 1.0
 *   --vig-spread:   110% -> 140%
 *   --cap-shadow:   28px -> 48px
 *
 * The analyser can be null (no-op) or swapped dynamically
 * (e.g. switching between capture and playback analysers).
 */
export function useAudioVisualSync(analyser: AnalyserNode | null) {
  const rafRef = useRef(0);

  useEffect(() => {
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const root = document.documentElement;

    function tick() {
      analyser!.getByteFrequencyData(data);

      // Compute normalized average energy (0..1)
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i];
      }
      const energy = sum / data.length / 255;

      // Map energy to CSS custom properties
      root.style.setProperty('--ken-speed', `${28 - energy * 8}s`);
      root.style.setProperty('--glow-opacity', `${0.5 + energy * 0.5}`);
      root.style.setProperty('--vig-spread', `${110 + energy * 30}%`);
      root.style.setProperty('--cap-shadow', `${28 + energy * 20}px`);

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      // Reset to defaults on cleanup
      root.style.setProperty('--ken-speed', '28s');
      root.style.setProperty('--glow-opacity', '0.5');
      root.style.setProperty('--vig-spread', '110%');
      root.style.setProperty('--cap-shadow', '28px');
    };
  }, [analyser]);
}
