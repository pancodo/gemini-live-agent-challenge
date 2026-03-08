import { useState, useEffect, useMemo } from 'react';
import type { Segment } from '../../types';
import { usePlayerStore } from '../../store/playerStore';
import { useVoiceStore } from '../../store/voiceStore';

interface KenBurnsStageProps {
  segment: Segment | null;
}

const DRIFT_PRESETS = [
  { xStart: '0%', yStart: '0%', xEnd: '1%', yEnd: '0.5%' },
  { xStart: '-3%', yStart: '-2%', xEnd: '0%', yEnd: '0%' },
  { xStart: '3%', yStart: '0%', xEnd: '-1%', yEnd: '-1%' },
  { xStart: '0%', yStart: '-3%', xEnd: '1%', yEnd: '0%' },
];

const CROSSFADE_DURATION_MS = 2000;
const CYCLE_INTERVAL_MS = 10000;

export function KenBurnsStage({ segment }: KenBurnsStageProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const isKenBurnsPaused = usePlayerStore((s) => s.isKenBurnsPaused);
  const voiceState = useVoiceStore((s) => s.state);

  const shouldPause =
    isKenBurnsPaused ||
    voiceState === 'listening' ||
    voiceState === 'processing';

  const images = segment?.imageUrls ?? [];
  const hasVideo = Boolean(segment?.videoUrl);

  // Assign a random drift preset to each image index (stable per segment)
  const driftAssignments = useMemo(() => {
    if (images.length === 0) return [];
    return images.map((_, i) => DRIFT_PRESETS[i % DRIFT_PRESETS.length]);
  }, [images]);

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

  const playState = shouldPause ? 'paused' : 'running';

  if (!segment) {
    return (
      <div
        className="absolute inset-0"
        style={{ background: 'var(--bg-deep)' }}
      />
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
    <div className="absolute inset-0 overflow-hidden">
      <style>{`
        @keyframes ken-burns-0 {
          0%   { transform: scale(1.0) translate(${driftAssignments[0]?.xStart ?? '0%'}, ${driftAssignments[0]?.yStart ?? '0%'}); }
          100% { transform: scale(1.12) translate(${driftAssignments[0]?.xEnd ?? '1%'}, ${driftAssignments[0]?.yEnd ?? '0.5%'}); }
        }
        @keyframes ken-burns-1 {
          0%   { transform: scale(1.0) translate(${driftAssignments[1]?.xStart ?? '0%'}, ${driftAssignments[1]?.yStart ?? '0%'}); }
          100% { transform: scale(1.12) translate(${driftAssignments[1]?.xEnd ?? '1%'}, ${driftAssignments[1]?.yEnd ?? '0.5%'}); }
        }
        @keyframes ken-burns-2 {
          0%   { transform: scale(1.0) translate(${driftAssignments[2]?.xStart ?? '0%'}, ${driftAssignments[2]?.yStart ?? '0%'}); }
          100% { transform: scale(1.12) translate(${driftAssignments[2]?.xEnd ?? '1%'}, ${driftAssignments[2]?.yEnd ?? '0.5%'}); }
        }
        @keyframes ken-burns-3 {
          0%   { transform: scale(1.0) translate(${driftAssignments[3]?.xStart ?? '0%'}, ${driftAssignments[3]?.yStart ?? '0%'}); }
          100% { transform: scale(1.12) translate(${driftAssignments[3]?.xEnd ?? '1%'}, ${driftAssignments[3]?.yEnd ?? '0.5%'}); }
        }
      `}</style>

      {images.map((url, i) => {
        const isActive = i === currentIndex;
        return (
          <img
            key={`${segment.id}-${i}`}
            src={url}
            alt=""
            role="presentation"
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              opacity: isActive ? 1 : 0,
              transition: `opacity ${CROSSFADE_DURATION_MS}ms ease-in-out`,
              animation: `ken-burns-${i % 4} var(--ken-speed) ease-in-out infinite alternate`,
              animationPlayState: isActive ? playState : 'paused',
              willChange: 'transform, opacity',
            }}
          />
        );
      })}

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
