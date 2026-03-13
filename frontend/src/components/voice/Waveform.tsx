import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';

// Module-level Motion constants for the fallback bars.
const BAR_ANIMATE = { scaleY: [0.4, 1.0, 0.4] };
function barTransition(i: number) {
  return {
    duration: 0.8,
    delay: i * 0.12,
    repeat: Infinity,
    ease: 'easeInOut',
  } as const;
}
// Pre-computed transitions for the three bars (indices 0, 1, 2).
const BAR_TRANSITIONS = [0, 1, 2].map(barTransition);

export interface WaveformProps {
  analyser: AnalyserNode | null;
  height?: number;
}

/**
 * Canvas-based waveform visualizer driven by an AnalyserNode.
 *
 * Primary mode: draws smooth organic curves from time-domain data
 * using quadraticCurveTo with a warm gold stroke and glow.
 *
 * Fallback mode (no analyser or prefers-reduced-motion): three
 * Motion-animated vertical bars oscillating in height.
 */
export function Waveform({ analyser, height = 48 }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  // Dimensions maintained by ResizeObserver — not queried inside the draw loop.
  const canvasSizeRef = useRef<{ w: number; h: number; cssW: number; cssH: number }>({
    w: 0, h: 0, cssW: 0, cssH: 0,
  });
  const prefersReducedMotion = useReducedMotion();

  // ResizeObserver: update dimension ref whenever the canvas CSS size changes.
  // The draw loop reads from the ref — never calls getBoundingClientRect().
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height: h } = entry.contentRect;
      canvasSizeRef.current = { w: width * dpr, h: h * dpr, cssW: width, cssH: h };
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser || prefersReducedMotion) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      if (!canvas || !ctx) return;

      // Resize canvas backing store only when ResizeObserver reports a change.
      const { w: newW, h: newH, cssW, cssH } = canvasSizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      if (newW > 0 && (canvas.width !== newW || canvas.height !== newH)) {
        canvas.width = newW;
        canvas.height = newH;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      const width = cssW || canvas.clientWidth;
      const h = cssH || canvas.clientHeight;

      analyser!.getByteTimeDomainData(dataArray);

      ctx.clearRect(0, 0, width, h);

      // Warm gold stroke with glow
      ctx.strokeStyle = '#c4956a';
      ctx.lineWidth = 2;
      ctx.shadowBlur = 8;
      ctx.shadowColor = 'rgba(196, 149, 106, 0.6)';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.beginPath();

      const sliceWidth = width / (dataArray.length - 1);
      let prevX = 0;
      let prevY = (dataArray[0] / 255) * h;
      ctx.moveTo(prevX, prevY);

      for (let i = 1; i < dataArray.length; i++) {
        const x = i * sliceWidth;
        const y = (dataArray[i] / 255) * h;
        // Quadratic curve with control point at midpoint for organic smoothness
        const cpX = (prevX + x) / 2;
        const cpY = (prevY + y) / 2;
        ctx.quadraticCurveTo(prevX, prevY, cpX, cpY);
        prevX = x;
        prevY = y;
      }

      // Final segment to last point
      ctx.lineTo(prevX, prevY);
      ctx.stroke();

      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      // Reset tracked size so the next effect run always performs the first resize.
      canvasSizeRef.current = { w: 0, h: 0, cssW: 0, cssH: 0 };
    };
  }, [analyser, prefersReducedMotion]);

  // Fallback: three animated bars
  if (!analyser || prefersReducedMotion) {
    return (
      <div
        className="flex items-center justify-center gap-1"
        style={{ height }}
        role="img"
        aria-label="Audio waveform"
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-0.5 rounded-full bg-[#c4956a]"
            style={{ height: height * 0.6 }}
            animate={BAR_ANIMATE}
            transition={BAR_TRANSITIONS[i]}
          />
        ))}
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full"
      style={{ height }}
      role="img"
      aria-label="Audio waveform"
    />
  );
}
