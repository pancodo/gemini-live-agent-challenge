import { useEffect, useRef, useState, useCallback } from 'react';
import type { PortraitEra } from '../types';
import { computeAudioEnergy } from '../utils/audioEnergy';

// ── Types ────────────────────────────────────────────────────

interface PortraitImages {
  base: HTMLImageElement;
  mouth: HTMLImageElement;
  eyes: HTMLImageElement;
}

interface UsePortraitRendererOptions {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  era: PortraitEra;
  size: number;
  analyserNode: AnalyserNode | null;
  active: boolean;
  /** Dev mode: simulate audio energy with a sine wave for testing */
  simulateAudio?: boolean;
}

interface UsePortraitRendererReturn {
  isLoaded: boolean;
}

// ── Constants ────────────────────────────────────────────────

const ERA_CROSSFADE_MS = 800;
const BLINK_DURATION_MS = 320;
const BLINK_MIN_INTERVAL_MS = 3000;
const BLINK_MAX_INTERVAL_MS = 6000;
const ENERGY_SMOOTH_FACTOR = 0.3;
const MOUTH_SCALE = 2.5;

// ── Image Loader ─────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

async function loadEraImages(era: PortraitEra): Promise<PortraitImages> {
  const [base, mouth, eyes] = await Promise.all([
    loadImage(`/portraits/${era}/base.png`),
    loadImage(`/portraits/${era}/mouth.png`),
    loadImage(`/portraits/${era}/eyes.png`),
  ]);
  return { base, mouth, eyes };
}

// ── Hook ─────────────────────────────────────────────────────

export function usePortraitRenderer({
  canvasRef,
  era,
  size,
  analyserNode,
  active,
  simulateAudio = false,
}: UsePortraitRendererOptions): UsePortraitRendererReturn {
  const [isLoaded, setIsLoaded] = useState(false);

  // Mutable refs for rAF loop state
  const imagesRef = useRef<PortraitImages | null>(null);
  const prevImagesRef = useRef<PortraitImages | null>(null);
  const crossfadeRef = useRef({ active: false, startTime: 0 });
  const smoothEnergyRef = useRef(0);
  const blinkRef = useRef({ active: false, startTime: 0, nextBlink: 0 });
  const freqBufferRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(analyserNode);
  const rafRef = useRef(0);

  // Keep analyserRef in sync without triggering effect re-runs
  analyserRef.current = analyserNode;

  // Schedule next random blink
  const scheduleNextBlink = useCallback(() => {
    const delay = BLINK_MIN_INTERVAL_MS + Math.random() * (BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS);
    blinkRef.current.nextBlink = performance.now() + delay;
  }, []);

  // Load images when era changes
  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    loadEraImages(era).then((imgs) => {
      if (cancelled) return;

      // If we already have images, start crossfade
      if (imagesRef.current) {
        prevImagesRef.current = imagesRef.current;
        crossfadeRef.current = { active: true, startTime: performance.now() };
      }

      imagesRef.current = imgs;
      setIsLoaded(true);
    }).catch((err) => {
      console.warn(`[LivingPortrait] Failed to load era "${era}":`, err);
    });

    return () => { cancelled = true; };
  }, [era, active]);

  // Main rendering loop
  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    scheduleNextBlink();

    function drawPortrait(imgs: PortraitImages, alpha: number, now: number) {
      if (!ctx) return;

      // Base
      ctx.globalAlpha = alpha;
      ctx.drawImage(imgs.base, 0, 0, size, size);

      // Mouth overlay — driven by audio energy
      const energy = smoothEnergyRef.current;
      const mouthAlpha = Math.min(1, energy * MOUTH_SCALE) * alpha;
      if (mouthAlpha > 0.01) {
        ctx.globalAlpha = mouthAlpha;
        ctx.drawImage(imgs.mouth, 0, 0, size, size);
      }

      // Eye blink overlay
      const blink = blinkRef.current;
      if (blink.active) {
        const elapsed = now - blink.startTime;
        if (elapsed >= BLINK_DURATION_MS) {
          blink.active = false;
          scheduleNextBlink();
        } else {
          // Smooth sine curve: 0 → 1 → 0 over the full duration
          const t = elapsed / BLINK_DURATION_MS;
          const blinkAlpha = Math.sin(t * Math.PI);
          ctx.globalAlpha = blinkAlpha * alpha;
          ctx.drawImage(imgs.eyes, 0, 0, size, size);
        }
      }
    }

    function tick() {
      rafRef.current = requestAnimationFrame(tick);

      // Skip when tab hidden
      if (document.visibilityState === 'hidden') return;

      const imgs = imagesRef.current;
      if (!imgs || !ctx) return;

      const now = performance.now();

      // Update audio energy
      if (simulateAudio) {
        // Dev mode: sine wave with random bursts to simulate speech
        const t = now / 1000;
        const base = Math.sin(t * 3) * 0.3 + 0.3;
        const burst = Math.sin(t * 7) * Math.sin(t * 1.3) * 0.4;
        const rawEnergy = Math.max(0, Math.min(1, base + burst));
        smoothEnergyRef.current =
          smoothEnergyRef.current * (1 - ENERGY_SMOOTH_FACTOR) + rawEnergy * ENERGY_SMOOTH_FACTOR;
      } else {
        const currentAnalyser = analyserRef.current;
        if (currentAnalyser) {
          if (!freqBufferRef.current || freqBufferRef.current.length !== currentAnalyser.frequencyBinCount) {
            freqBufferRef.current = new Uint8Array(currentAnalyser.frequencyBinCount);
          }
          const rawEnergy = computeAudioEnergy(currentAnalyser, freqBufferRef.current);
          smoothEnergyRef.current =
            smoothEnergyRef.current * (1 - ENERGY_SMOOTH_FACTOR) + rawEnergy * ENERGY_SMOOTH_FACTOR;
        } else {
          smoothEnergyRef.current *= 0.9; // decay to 0 when no analyser
        }
      }

      // Trigger blink
      const blink = blinkRef.current;
      if (!blink.active && now >= blink.nextBlink) {
        blink.active = true;
        blink.startTime = now;
      }

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // Era crossfade
      const cf = crossfadeRef.current;
      if (cf.active && prevImagesRef.current) {
        const t = Math.min(1, (now - cf.startTime) / ERA_CROSSFADE_MS);
        drawPortrait(prevImagesRef.current, 1 - t, now);
        drawPortrait(imgs, t, now);
        if (t >= 1) {
          cf.active = false;
          prevImagesRef.current = null;
        }
      } else {
        drawPortrait(imgs, 1, now);
      }

      ctx.globalAlpha = 1;
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      imagesRef.current = null;
      prevImagesRef.current = null;
    };
  }, [active, size, canvasRef, scheduleNextBlink, simulateAudio]);

  return { isLoaded };
}
