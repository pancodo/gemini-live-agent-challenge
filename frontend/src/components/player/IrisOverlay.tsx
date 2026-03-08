import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerStore } from '../../store/playerStore';

/**
 * IrisOverlay — animates the cinematic iris transition when entering the player.
 *
 * Phase 1 (0-650ms):  iris-close  ->  radial mask shrinks to 0 (goes full black)
 * Phase 2 (650ms):    navigate to target path
 * Phase 3 (650-1400ms): iris-open ->  radial mask expands to 150% (player revealed)
 *
 * Driven by playerStore.irisTargetPath — when non-null, animation begins.
 * Resets irisTargetPath to null after completion.
 *
 * Falls back to instant navigation if `prefers-reduced-motion` is set.
 */
export function IrisOverlay() {
  const irisTargetPath = usePlayerStore((s) => s.irisTargetPath);
  const clearIris = usePlayerStore((s) => s.clearIris);
  const navigate = useNavigate();
  const overlayRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    if (!irisTargetPath || activeRef.current) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    // Respect prefers-reduced-motion: skip iris, navigate instantly
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      navigate(irisTargetPath);
      clearIris();
      return;
    }

    activeRef.current = true;

    // Show overlay and start iris-close
    overlay.style.display = 'block';
    overlay.classList.remove('iris-close', 'iris-open');
    // Force reflow so animation restarts cleanly
    void overlay.offsetWidth;
    overlay.classList.add('iris-close');

    // After iris closes (650ms): navigate, then iris-open
    const closeTimer = setTimeout(() => {
      navigate(irisTargetPath);

      overlay.classList.remove('iris-close');
      void overlay.offsetWidth;
      overlay.classList.add('iris-open');

      // After iris opens (750ms): hide overlay and reset
      const openTimer = setTimeout(() => {
        overlay.classList.remove('iris-open');
        overlay.style.display = 'none';
        activeRef.current = false;
        clearIris();
      }, 750);

      return () => clearTimeout(openTimer);
    }, 650);

    return () => {
      clearTimeout(closeTimer);
    };
  }, [irisTargetPath, navigate, clearIris]);

  return (
    <div
      ref={overlayRef}
      className="iris-overlay"
      aria-hidden="true"
      role="presentation"
    />
  );
}
