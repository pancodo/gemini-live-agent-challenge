import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';

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
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !analyser || prefersReducedMotion) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    function draw() {
      if (!canvas || !ctx) return;

      // Size canvas to container (handle DPR for crisp lines)
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const width = rect.width;
      const h = rect.height;

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
            animate={{ scaleY: [0.4, 1.0, 0.4] }}
            transition={{
              duration: 0.8,
              delay: i * 0.12,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
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
