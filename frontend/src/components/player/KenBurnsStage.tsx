import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Segment } from '../../types';
import { usePlayerStore } from '../../store/playerStore';
import { useVoiceStore } from '../../store/voiceStore';

/**
 * Module-level cached canvas for sampleImageColor.
 * Avoids creating a new DOM element on every color sample call.
 */
let _samplerCanvas: HTMLCanvasElement | null = null;
function getSamplerCanvas(): HTMLCanvasElement {
  if (!_samplerCanvas) {
    _samplerCanvas = document.createElement('canvas');
    _samplerCanvas.width = 4;
    _samplerCanvas.height = 4;
  }
  return _samplerCanvas;
}

/**
 * Sample the dominant color from an image by down-scaling to 4x4
 * and averaging the top row. Returns an rgba string for use as
 * the ambient glow color (YouTube ambient mode style).
 */
function sampleImageColor(img: HTMLImageElement): string {
  const canvas = getSamplerCanvas();
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return 'transparent';
  ctx.drawImage(img, 0, 0, 4, 4);
  const d = ctx.getImageData(0, 0, 4, 4).data;
  const r = Math.round((d[0] + d[4] + d[8] + d[12]) / 4);
  const g = Math.round((d[1] + d[5] + d[9] + d[13]) / 4);
  const b = Math.round((d[2] + d[6] + d[10] + d[14]) / 4);
  return `rgba(${r},${g},${b},0.3)`;
}

interface KenBurnsStageProps {
  segment: Segment | null;
  /** Called whenever the visible image index changes (or on initial mount). */
  onActiveImageChange?: (url: string | null) => void;
}

const CROSSFADE_DURATION_MS = 2000;
const CYCLE_INTERVAL_MS = 7000;

export function KenBurnsStage({ segment, onActiveImageChange }: KenBurnsStageProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const isKenBurnsPaused = usePlayerStore((s) => s.isKenBurnsPaused);
  const liveIllustration = usePlayerStore((s) => s.liveIllustration);
  const voiceState = useVoiceStore((s) => s.state);

  const shouldPause =
    isKenBurnsPaused ||
    voiceState === 'listening' ||
    voiceState === 'processing';

  const images = segment?.imageUrls ?? [];
  const hasVideo = Boolean(segment?.videoUrl);

  // Cycle through images
  useEffect(() => {
    if (hasVideo || images.length <= 1 || shouldPause) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }, CYCLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [hasVideo, images.length, shouldPause]);

  // Reset index when segment changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [segment?.id]);

  // Notify parent of active image URL whenever it changes
  useEffect(() => {
    if (!onActiveImageChange) return;
    const url = images[currentIndex] ?? null;
    onActiveImageChange(url);
  }, [currentIndex, images, onActiveImageChange]);

  const playState = shouldPause ? 'paused' : 'running';

  // Ambient color sampling — writes --ambient-color to .player-root ancestor
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>, index: number) => {
      // Only sample from the currently active image
      if (index !== currentIndex) return;
      const imgEl = e.currentTarget;
      try {
        const color = sampleImageColor(imgEl);
        document
          .querySelector<HTMLElement>('.player-root')
          ?.style.setProperty('--ambient-color', color);
      } catch {
        // Canvas taint from CORS — silently ignore
      }
    },
    [currentIndex],
  );

  // Re-sample when currentIndex changes (image may already be loaded)
  useEffect(() => {
    const activeImg = document.querySelector<HTMLImageElement>(
      `.player-stage img[data-index="${currentIndex}"]`,
    );
    if (activeImg?.complete && activeImg.naturalWidth > 0) {
      try {
        const color = sampleImageColor(activeImg);
        document
          .querySelector<HTMLElement>('.player-root')
          ?.style.setProperty('--ambient-color', color);
      } catch {
        // Canvas taint — ignore
      }
    }
  }, [currentIndex]);

  if (!segment) {
    return (
      <div
        className="absolute inset-0"
        style={{ background: 'var(--player-bg)' }}
      />
    );
  }

  if (images.length === 0 && !hasVideo) {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ background: 'var(--player-bg)' }}
      >
        {/* Ornamental pulse ring */}
        <div
          className="kb-skeleton-pulse"
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            border: '1px solid rgba(196,149,106,0.3)',
          }}
        />
        <p
          className="mt-4"
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.3em',
            color: 'var(--player-text-dim)',
          }}
        >
          Loading visuals…
        </p>
        {/* Vignette overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse var(--vig-spread) 100% at 50% 100%, transparent 40%, rgba(0,0,0,0.85) 100%)',
          }}
        />
      </div>
    );
  }

  if (hasVideo) {
    return (
      <div className="absolute inset-0">
        <video
          src={segment.videoUrl}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Vignette overlay */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse var(--vig-spread) 100% at 50% 100%, transparent 40%, rgba(0,0,0,0.85) 100%)',
          }}
        />
      </div>
    );
  }

  return (
    // key={segment.id} forces a full remount on every segment change so that:
    // 1. All ken-burns @keyframe animations restart from 0% rather than
    //    continuing from wherever they were in the previous segment's cycle.
    // 2. currentIndex is implicitly reset to 0 because the component remounts.
    <div key={segment.id} className="absolute inset-0 overflow-hidden player-stage">
      {images.map((url, i) => {
        const isActive = i === currentIndex;
        return (
          <img
            key={`${segment.id}-${i}`}
            src={url}
            alt=""
            role="presentation"
            data-index={i}
            onLoad={(e) => handleImageLoad(e, i)}
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              opacity: isActive ? 1 : 0,
              transition: `opacity ${CROSSFADE_DURATION_MS}ms ease-in-out`,
              // Only the active image runs its drift animation; inactive images
              // are paused so they don't burn through GPU resources and so that
              // when they become active they start the animation fresh from the
              // beginning (animationPlayState: 'paused' holds them at the
              // initial keyframe position).
              animation: `ken-burns-${i % 4} var(--ken-speed) ease-in-out infinite alternate`,
              animationPlayState: isActive ? playState : 'paused',
              pointerEvents: isActive ? 'auto' : 'none',
              willChange: isActive ? 'transform, opacity' : 'auto',
            }}
          />
        );
      })}

      {/* Live illustration overlay */}
      <AnimatePresence>
        {liveIllustration && (
          <motion.img
            key={liveIllustration.imageUrl}
            src={liveIllustration.imageUrl}
            alt=""
            role="presentation"
            initial={{ opacity: 0, scale: 1.0 }}
            animate={{ opacity: 1, scale: 1.08 }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 1.2, ease: 'easeInOut' },
              scale: { duration: 20, ease: 'linear' },
            }}
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              zIndex: 2,
              willChange: 'transform, opacity',
            }}
          />
        )}
      </AnimatePresence>

      {/* Illustration shimmer glow */}
      {liveIllustration && (
        <div
          className="illustration-shimmer absolute inset-0 pointer-events-none"
          style={{ zIndex: 1 }}
        />
      )}

      {/* Vignette overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse var(--vig-spread) 100% at 50% 100%, transparent 40%, rgba(0,0,0,0.85) 100%)',
        }}
      />
    </div>
  );
}
