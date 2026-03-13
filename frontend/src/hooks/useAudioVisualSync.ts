import { useEffect, useRef } from 'react';

/**
 * Reads AnalyserNode frequency data each rAF frame and drives
 * audio-reactive visuals on the documentary player.
 *
 * Driven properties (scoped to #player-container, not :root):
 *   --glow-opacity: 0.5 -> 1.0
 *   --vig-spread:   110% -> 140%
 *   --cap-shadow:   28px -> 48px
 *
 * Ken Burns speed is controlled via Web Animations API playbackRate
 * instead of CSS custom properties. Mutating animation-duration via
 * setProperty causes visible jumps because the browser re-snapshots
 * the duration and restarts timing. playbackRate smoothly scales
 * the running animation without any restart.
 *
 * All setProperty calls target #player-container instead of :root
 * to avoid invalidating style calculations document-wide.
 *
 * The analyser can be null (no-op) or swapped dynamically
 * (e.g. switching between capture and playback analysers).
 */
export function useAudioVisualSync(analyser: AnalyserNode | null) {
  const rafRef = useRef(0);

  useEffect(() => {
    if (!analyser) return;

    const data = new Uint8Array(analyser.frequencyBinCount);

    // Cache DOM queries once at effect setup — not per frame.
    const kenEl = document.querySelector('.ken-burns-stage');
    const container = document.getElementById('player-container');
    // Cache the animation reference once; it won't change while the stage is mounted.
    const kenAnim = kenEl?.getAnimations()[0] ?? null;

    function tick() {
      // Skip all work when the tab is hidden — saves GPU and CPU entirely.
      if (document.visibilityState === 'hidden') {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      analyser!.getByteFrequencyData(data);

      // Compute normalized average energy (0..1)
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        sum += data[i];
      }
      const energy = sum / data.length / 255;

      // Control Ken Burns animation speed via playbackRate (no CSS jump)
      // Maps: 0.7x at silence -> 1.3x at narration peak
      if (kenAnim) {
        kenAnim.playbackRate = 0.7 + energy * 0.6;
      }

      // Scope all CSS custom property writes to the player container
      // to avoid invalidating the entire document style tree.
      // Guard: container may be null on non-player routes — keep rAF alive regardless.
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

      // Reset Ken Burns playback rate
      if (kenAnim) {
        kenAnim.playbackRate = 1.0;
      }

      // Reset CSS custom properties on the scoped container
      if (container) {
        container.style.setProperty('--glow-opacity', '0.5');
        container.style.setProperty('--vig-spread', '110%');
        container.style.setProperty('--cap-shadow', '28px');
      }
    };
  }, [analyser]);
}
