import { useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/playerStore';

/**
 * Reads AnalyserNode frequency data each rAF frame and drives
 * audio-reactive visuals on the documentary player.
 *
 * Driven properties (scoped to #player-container, not :root):
 *   --glow-opacity: 0.5 -> 1.0
 *   --vig-spread:   110% -> 140%
 *   --cap-shadow:   28px -> 48px
 *
 * Beat pulse: when beatTransitioning is true, energy is multiplied
 * by 1.8 for 2 seconds, creating a visual "breath" on beat changes.
 *
 * Ken Burns speed is controlled via Web Animations API playbackRate
 * instead of CSS custom properties (no restart jank).
 */
export function useAudioVisualSync(analyser: AnalyserNode | null) {
  const rafRef = useRef(0);
  const beatPulseRef = useRef(1.0);
  const beatPulseDecayRef = useRef(0);

  useEffect(() => {
    // Subscribe to beatTransitioning changes for beat pulse
    let prev = false;
    const unsub = usePlayerStore.subscribe((state) => {
      if (state.beatTransitioning && !prev) {
        beatPulseRef.current = 1.8;
        beatPulseDecayRef.current = Date.now();
      }
      prev = state.beatTransitioning;
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);
    const container = document.getElementById('player-container');

    function tick() {
      if (document.visibilityState === 'hidden') {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      analyser!.getByteFrequencyData(data);

      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i];
      }
      let energy = sum / data.length / 255;

      // Beat pulse: decay from 1.8 back to 1.0 over 2 seconds
      if (beatPulseRef.current > 1.0) {
        const elapsed = (Date.now() - beatPulseDecayRef.current) / 2000;
        beatPulseRef.current = Math.max(1.0, 1.8 - elapsed * 0.8);
        energy = Math.min(1.0, energy * beatPulseRef.current);
      }

      if (container) {
        container.style.setProperty('--glow-opacity', `${0.5 + energy * 0.5}`);
        container.style.setProperty('--vig-spread', `${110 + energy * 30}%`);
        container.style.setProperty('--cap-shadow', `${28 + energy * 20}px`);
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);

      if (container) {
        container.style.setProperty('--glow-opacity', '0.5');
        container.style.setProperty('--vig-spread', '110%');
        container.style.setProperty('--cap-shadow', '28px');
      }
    };
  }, [analyser]);
}
