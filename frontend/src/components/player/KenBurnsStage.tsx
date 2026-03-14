import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Segment } from '../../types';
import { usePlayerStore } from '../../store/playerStore';
import { useVoiceStore } from '../../store/voiceStore';
import { VisualSourceBadge } from '../ui';

type PoolEntry = {
  url: string;
  source: 'interleaved' | 'imagen' | 'veo';
  kenBurnsIndex: number;
};

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

const GALLERY_CYCLE_MS = 5000;

export function KenBurnsStage({ segment, onActiveImageChange }: KenBurnsStageProps) {
  const [poolIndex, setPoolIndex] = useState(0);
  const hasRevealedFirstRef = useRef(false);
  const isKenBurnsPaused = usePlayerStore((s) => s.isKenBurnsPaused);
  const liveIllustration = usePlayerStore((s) => s.liveIllustration);
  const beats = usePlayerStore((s) => s.beats);
  const currentBeatIndex = usePlayerStore((s) => s.currentBeatIndex);
  const voiceState = useVoiceStore((s) => s.state);

  // Determine current beat visual for source badge
  const currentBeat = beats[currentBeatIndex] ?? null;
  const beatVideoUrl = currentBeat?.videoUrl ?? null;

  const shouldPause =
    isKenBurnsPaused ||
    voiceState === 'listening' ||
    voiceState === 'processing';

  const images = segment?.imageUrls ?? [];
  const hasVideo = Boolean(segment?.videoUrl);

  // ── Build image pool: interleave beat images + segment Imagen frames ──
  const imagePool = useMemo<PoolEntry[]>(() => {
    const pool: PoolEntry[] = [];
    const beatUrls: PoolEntry[] = [];
    const segUrls: PoolEntry[] = [];

    // Collect beat images
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      const url = b?.cinematicUrl ?? b?.imageUrl ?? null;
      if (url) {
        beatUrls.push({
          url,
          source: b?.cinematicUrl ? 'imagen' : 'interleaved',
          kenBurnsIndex: i % 4,
        });
      }
    }

    // Collect segment Imagen 3 frames
    for (let i = 0; i < images.length; i++) {
      segUrls.push({
        url: images[i],
        source: 'imagen',
        kenBurnsIndex: (i + 2) % 4, // offset for visual variety
      });
    }

    // Interleave: beat, seg, beat, seg, ...
    const maxLen = Math.max(beatUrls.length, segUrls.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < beatUrls.length) pool.push(beatUrls[i]);
      if (i < segUrls.length) pool.push(segUrls[i]);
    }

    // If no beat images, just use segment images
    if (pool.length === 0) {
      return segUrls;
    }

    return pool;
  }, [beats, images]);

  // ── Beat-aware pool reset: jump to beat's image on beat change ──
  useEffect(() => {
    if (beats.length === 0 || imagePool.length === 0) return;
    const beat = beats[currentBeatIndex];
    const beatUrl = beat?.cinematicUrl ?? beat?.imageUrl ?? null;
    if (!beatUrl) return;

    // Find this beat's image in the pool
    const idx = imagePool.findIndex((e) => e.url === beatUrl);
    if (idx >= 0) {
      setPoolIndex(idx);
    }
  }, [currentBeatIndex, beats, imagePool]);

  // ── Gallery cycling: every 5s, advance to next image in pool ──
  useEffect(() => {
    if (imagePool.length <= 1 || shouldPause || hasVideo) return;

    const interval = setInterval(() => {
      setPoolIndex((prev) => (prev + 1) % imagePool.length);
    }, GALLERY_CYCLE_MS);

    return () => clearInterval(interval);
  }, [imagePool.length, shouldPause, hasVideo]);

  // Reset on segment change
  useEffect(() => {
    setPoolIndex(0);
    hasRevealedFirstRef.current = false;
  }, [segment?.id]);

  // Notify parent of active image
  useEffect(() => {
    if (!onActiveImageChange) return;
    const entry = imagePool[poolIndex];
    onActiveImageChange(entry?.url ?? null);
  }, [poolIndex, imagePool, onActiveImageChange]);

  const playState = shouldPause ? 'paused' : 'running';

  // Current pool entry
  const currentEntry = imagePool[poolIndex] ?? null;

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
        // Canvas taint from CORS — silently ignore
      }
    },
    [],
  );

  if (!segment) {
    return (
      <div
        className="absolute inset-0"
        style={{ background: 'var(--player-bg)' }}
      />
    );
  }

  if (imagePool.length === 0 && !hasVideo) {
    return (
      <div
        className="absolute inset-0 flex flex-col items-center justify-center"
        style={{ background: 'var(--player-bg)' }}
      >
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
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse var(--vig-spread) 100% at 50% 100%, transparent 40%, var(--player-vignette) 100%)',
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
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse var(--vig-spread) 100% at 50% 100%, transparent 40%, var(--player-vignette) 100%)',
          }}
        />
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
            <video
              src={beatVideoUrl}
              autoPlay
              muted
              loop
              playsInline
              className="h-full w-full object-cover"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Image gallery — continuous cycling with parallax depth transitions */}
      <AnimatePresence mode="sync">
        {currentEntry && (
          <motion.div
            key={`pool-${poolIndex}`}
            className="absolute inset-0"
            style={{ zIndex: 2 }}
            initial={{ opacity: 0, scale: 1.06, y: '1.5%', filter: 'blur(2px)' }}
            animate={{ opacity: 1, scale: 1, y: '0%', filter: 'blur(0px)' }}
            exit={{ opacity: 0, scale: 0.97, filter: 'blur(6px)' }}
            transition={{ duration: 1.4, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <img
              src={currentEntry.url}
              alt=""
              role="presentation"
              onLoad={handleImageLoad}
              className="h-full w-full object-cover"
              style={{
                animation: `ken-burns-${currentEntry.kenBurnsIndex} var(--ken-speed, 28s) ease-in-out infinite alternate`,
                animationPlayState: playState,
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

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
              scale: {
                type: 'spring',
                stiffness: 20,
                damping: 15,
                mass: 1,
                duration: 20,
              },
            }}
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              zIndex: 4,
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

      {/* Visual source badge — dynamically shows current image source */}
      {currentEntry && (
        <div
          className="absolute top-4 right-4 z-10 pointer-events-none"
          style={{ opacity: 'var(--chrome-opacity, 1)', transition: 'opacity 0.4s ease' }}
        >
          <VisualSourceBadge
            source={currentEntry.source}
            compact
          />
        </div>
      )}

      {/* Vignette overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse var(--vig-spread) 100% at 50% 100%, transparent 40%, var(--player-vignette) 100%)',
        }}
      />
    </div>
  );
}
