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
const WAKE_UP_MS = 1500;
const WAKE_UP_BLINK_AT_MS = 800;
const NOISE_TILE_SIZE = 64;
const NOISE_ALPHA = 0.015;
const NOISE_FRAME_INTERVAL = 5;
const CANDLE_BASE_ALPHA = 0.04;
const CANDLE_VARY = 0.02;

// ── Offscreen Texture Generators ────────────────────────────

function createNoisePattern(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = NOISE_TILE_SIZE;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(NOISE_TILE_SIZE, NOISE_TILE_SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function createCandlelightGradient(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size * 0.3, size * 0.25, 0,
    size * 0.3, size * 0.25, size * 0.85,
  );
  grad.addColorStop(0, 'rgba(255, 200, 120, 1)');
  grad.addColorStop(0.4, 'rgba(255, 180, 100, 0.5)');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return c;
}

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
  const wakeUpRef = useRef({ active: false, startTime: 0, blinkTriggered: false });
  const frameCountRef = useRef(0);

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

      // Trigger wake-up animation on first load only
      const isFirstLoad = !imagesRef.current && !prevImagesRef.current;
      imagesRef.current = imgs;
      if (isFirstLoad) {
        wakeUpRef.current = { active: true, startTime: performance.now(), blinkTriggered: false };
      }
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

    // Create offscreen textures once per effect lifecycle
    const noiseCanvas = createNoisePattern();
    const noisePattern = ctx.createPattern(noiseCanvas, 'repeat');
    const candleCanvas = createCandlelightGradient(size);

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
      frameCountRef.current++;

      // Update audio energy
      if (simulateAudio) {
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
          smoothEnergyRef.current *= 0.9;
        }
      }

      // Trigger blink
      const blink = blinkRef.current;
      if (!blink.active && now >= blink.nextBlink) {
        blink.active = true;
        blink.startTime = now;
      }

      // Wake-up: trigger deliberate slow blink partway through
      const wake = wakeUpRef.current;
      if (wake.active && !wake.blinkTriggered && (now - wake.startTime) >= WAKE_UP_BLINK_AT_MS) {
        wake.blinkTriggered = true;
        blink.active = true;
        blink.startTime = now;
      }

      // Clear canvas
      ctx.clearRect(0, 0, size, size);

      // ── Draw portrait layers ──────────────────────────
      const prevComposite = ctx.globalCompositeOperation;
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

      // ── Candlelight flicker (soft-light blend) ────────
      // Three incommensurate sine waves produce organic irregular flicker
      const s = now / 1000;
      const flickerAlpha = CANDLE_BASE_ALPHA +
        CANDLE_VARY * Math.sin(s * 3.0) * Math.sin(s * 1.7) * Math.sin(s * 7.1);
      ctx.globalCompositeOperation = 'soft-light';
      ctx.globalAlpha = Math.max(0, flickerAlpha);
      ctx.drawImage(candleCanvas, 0, 0, size, size);

      // ── Wake-up sepia overlay ─────────────────────────
      if (wake.active) {
        const elapsed = now - wake.startTime;
        if (elapsed >= WAKE_UP_MS) {
          wake.active = false;
        } else {
          // Ease-out: sepia fades from strong to zero
          const t = elapsed / WAKE_UP_MS;
          const sepiaAlpha = 0.15 * (1 - t) * (1 - t);
          ctx.globalCompositeOperation = 'color';
          ctx.globalAlpha = sepiaAlpha;
          ctx.fillStyle = 'rgb(160, 130, 90)';
          ctx.fillRect(0, 0, size, size);
        }
      }

      // ── Film grain noise (every N frames) ─────────────
      if (noisePattern && frameCountRef.current % NOISE_FRAME_INTERVAL === 0) {
        ctx.globalCompositeOperation = 'overlay';
        ctx.globalAlpha = NOISE_ALPHA;
        ctx.fillStyle = noisePattern;
        ctx.fillRect(0, 0, size, size);
      }

      // Reset composite state
      ctx.globalCompositeOperation = prevComposite;
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
