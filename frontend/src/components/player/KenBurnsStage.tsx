import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Segment } from '../../types';
import { usePlayerStore } from '../../store/playerStore';
import { useVoiceStore } from '../../store/voiceStore';
import { VisualSourceBadge } from '../ui';

/**
 * Module-level cached canvas for sampleImageColor.
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
  onActiveImageChange?: (url: string | null) => void;
}

/** Fallback cycle interval when no beats exist */
const FALLBACK_CYCLE_MS = 7000;
/** Delay before showing supplementary Imagen frame mid-beat */
const SUPPLEMENTARY_DELAY_MS = 8000;

export function KenBurnsStage({ segment, onActiveImageChange }: KenBurnsStageProps) {
  const isKenBurnsPaused = usePlayerStore((s) => s.isKenBurnsPaused);
  const liveIllustration = usePlayerStore((s) => s.liveIllustration);
  const beats = usePlayerStore((s) => s.beats);
  const currentBeatIndex = usePlayerStore((s) => s.currentBeatIndex);
  const voiceState = useVoiceStore((s) => s.state);

  // Current beat visual — if beat has no image, assign a segment image
  const currentBeat = beats[currentBeatIndex] ?? null;
  const images = segment?.imageUrls ?? [];
  const beatOwnUrl = currentBeat?.cinematicUrl ?? currentBeat?.imageUrl ?? null;
  // When beat has no image but segment has images, assign by beat index
  const primaryUrl = beatOwnUrl ?? (beats.length > 0 && images.length > 0
    ? images[currentBeatIndex % images.length]
    : null);
  const beatVideoUrl = currentBeat?.videoUrl ?? null;
  const hasBeatVisual = Boolean(primaryUrl || beatVideoUrl);

  // Supplementary Imagen frame (mid-beat visual variety)
  const [showSupplementary, setShowSupplementary] = useState(false);
  const supplementaryTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Fallback: cycle segment images when no beats exist
  const [fallbackIndex, setFallbackIndex] = useState(0);

  const shouldPause =
    isKenBurnsPaused ||
    voiceState === 'listening' ||
    voiceState === 'processing';
  const hasVideo = Boolean(segment?.videoUrl);

  // Get supplementary image for current beat — offset by 1 from primary
  // so it's always a different image for visual variety
  const supplementaryUrl = images.length > 1
    ? images[(currentBeatIndex + 1) % images.length]
    : null;

  // ── Beat-driven: show supplementary image 8s into each beat ──
  useEffect(() => {
    setShowSupplementary(false);
    clearTimeout(supplementaryTimerRef.current);

    // Only show supplementary when primary is a real beat image (not segment fallback)
    if (!beatOwnUrl || !supplementaryUrl || shouldPause) return;
    // Don't show supplementary if it's the same as primary
    if (supplementaryUrl === primaryUrl) return;

    supplementaryTimerRef.current = setTimeout(() => {
      setShowSupplementary(true);
    }, SUPPLEMENTARY_DELAY_MS);

    return () => clearTimeout(supplementaryTimerRef.current);
  }, [currentBeatIndex, hasBeatVisual, supplementaryUrl, primaryUrl, shouldPause]);

  // ── Fallback: cycle segment images when no beats ──
  useEffect(() => {
    if (hasBeatVisual || hasVideo || images.length <= 1 || shouldPause) return;

    const interval = setInterval(() => {
      setFallbackIndex((prev) => (prev + 1) % images.length);
    }, FALLBACK_CYCLE_MS);

    return () => clearInterval(interval);
  }, [hasBeatVisual, hasVideo, images.length, shouldPause]);

  // Reset on segment change
  useEffect(() => {
    setFallbackIndex(0);
    setShowSupplementary(false);
  }, [segment?.id]);

  // Determine current visible URL for parent notification + ambient color
  const visibleUrl = hasBeatVisual
    ? (showSupplementary && supplementaryUrl ? supplementaryUrl : primaryUrl)
    : (images[fallbackIndex] ?? null);

  // Notify parent of active image
  useEffect(() => {
    if (onActiveImageChange) onActiveImageChange(visibleUrl);
  }, [visibleUrl, onActiveImageChange]);

  const playState = shouldPause ? 'paused' : 'running';

  // Ambient color sampling
  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const imgEl = e.currentTarget;
      try {
        const color = sampleImageColor(imgEl);
        document
          .querySelector<HTMLElement>('.player-root')
          ?.style.setProperty('--ambient-color', color);
      } catch {
        // Canvas taint from CORS
      }
    },
    [],
  );

  // Determine current visual source for badge
  const currentSource: 'interleaved' | 'imagen' | 'veo' =
    beatVideoUrl && currentBeat?.visualType === 'video' ? 'veo'
    : showSupplementary && supplementaryUrl ? 'imagen'
    : currentBeat?.cinematicUrl ? 'imagen'
    : hasBeatVisual ? 'interleaved'
    : 'imagen';

  // ── Null / loading / video-only states ──

  if (!segment) {
    return <div className="absolute inset-0" style={{ background: 'var(--player-bg)' }} />;
  }

  if (!hasBeatVisual && images.length === 0 && !hasVideo) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: 'var(--player-bg)' }}>
        <div className="kb-skeleton-pulse" style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid rgba(196,149,106,0.3)' }} />
        <p className="mt-4" style={{ fontFamily: 'var(--font-serif)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.3em', color: 'var(--player-text-dim)' }}>
          Loading visuals…
        </p>
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse var(--vig-spread) 100% at 50% 100%, transparent 40%, var(--player-vignette) 100%)' }} />
      </div>
    );
  }

  if (hasVideo && !hasBeatVisual) {
    return (
      <div className="absolute inset-0">
        <video src={segment.videoUrl} autoPlay muted loop playsInline className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse var(--vig-spread) 100% at 50% 100%, transparent 40%, var(--player-vignette) 100%)' }} />
      </div>
    );
  }

  return (
    <div key={segment.id} className="absolute inset-0 overflow-hidden player-stage">
      {/* Video beat overlay */}
      <AnimatePresence>
        {beatVideoUrl && currentBeat?.visualType === 'video' && (
          <motion.div
            key={`beat-video-${currentBeatIndex}`}
            className="absolute inset-0"
            style={{ zIndex: 3 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          >
            <video src={beatVideoUrl} autoPlay muted loop playsInline className="h-full w-full object-cover" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* PRIMARY: Beat illustration — changes on beat advance (audio-synced) */}
      <AnimatePresence mode="sync">
        {primaryUrl && !showSupplementary && (
          <motion.div
            key={`beat-${currentBeatIndex}`}
            className="absolute inset-0"
            style={{ zIndex: 2 }}
            initial={{ opacity: 0, scale: 1.06, y: '1.5%', filter: 'blur(2px)' }}
            animate={{ opacity: 1, scale: 1, y: '0%', filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.97, filter: 'blur(6px)' }}
            transition={{ duration: 1.4, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <img
              src={primaryUrl}
              alt=""
              role="presentation"
              onLoad={handleImageLoad}
              className="h-full w-full object-cover"
              style={{
                animation: `ken-burns-${currentBeatIndex % 4} var(--ken-speed, 28s) ease-in-out infinite alternate`,
                animationPlayState: playState,
              }}
            />
          </motion.div>
        )}

        {/* SUPPLEMENTARY: Imagen 3 frame — crossfades in 8s after beat starts */}
        {showSupplementary && supplementaryUrl && (
          <motion.div
            key={`supp-${currentBeatIndex}`}
            className="absolute inset-0"
            style={{ zIndex: 2 }}
            initial={{ opacity: 0, scale: 1.04, filter: 'blur(2px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.97, filter: 'blur(6px)' }}
            transition={{ duration: 1.5, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <img
              src={supplementaryUrl}
              alt=""
              role="presentation"
              onLoad={handleImageLoad}
              className="h-full w-full object-cover"
              style={{
                animation: `ken-burns-${(currentBeatIndex + 2) % 4} var(--ken-speed, 28s) ease-in-out infinite alternate`,
                animationPlayState: playState,
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* FALLBACK: Segment images when no beats exist */}
      {!hasBeatVisual && images.length > 0 && (
        <AnimatePresence mode="sync">
          <motion.div
            key={`fallback-${fallbackIndex}`}
            className="absolute inset-0"
            style={{ zIndex: 1 }}
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 1.5, ease: 'easeInOut' }}
          >
            <img
              src={images[fallbackIndex]}
              alt=""
              role="presentation"
              onLoad={handleImageLoad}
              className="h-full w-full object-cover"
              style={{
                animation: `ken-burns-${fallbackIndex % 4} var(--ken-speed, 28s) ease-in-out infinite alternate`,
                animationPlayState: playState,
              }}
            />
          </motion.div>
        </AnimatePresence>
      )}

      {/* Live illustration overlay */}
      <AnimatePresence>
        {liveIllustration && (
          <motion.img
            key={liveIllustration.imageUrl}
            src={liveIllustration.imageUrl}
            alt=""
            role="presentation"
            initial={{ opacity: 0, scale: 1.04 }}
            animate={{ opacity: 1, scale: 1.08 }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 1.2, ease: 'easeInOut' },
              scale: { type: 'spring', stiffness: 20, damping: 15, mass: 1, duration: 20 },
            }}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ zIndex: 4, willChange: 'transform, opacity' }}
          />
        )}
      </AnimatePresence>

      {/* Illustration shimmer glow */}
      {liveIllustration && (
        <div className="illustration-shimmer absolute inset-0 pointer-events-none" style={{ zIndex: 1 }} />
      )}

      {/* Visual source badge */}
      {(hasBeatVisual || images.length > 0) && (
        <div
          className="absolute top-4 right-4 z-10 pointer-events-none"
          style={{ opacity: 'var(--chrome-opacity, 1)', transition: 'opacity 0.4s ease' }}
        >
          <VisualSourceBadge source={currentSource} compact />
        </div>
      )}

      {/* Vignette overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse var(--vig-spread) 100% at 50% 100%, transparent 40%, var(--player-vignette) 100%)',
        }}
      />
    </div>
  );
}
