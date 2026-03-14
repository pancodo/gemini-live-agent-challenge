import { useEffect, useRef, useMemo, memo, useCallback, type MouseEvent } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { useResearchStore, type StoryboardFrame } from '../../store/researchStore';
import { Badge, VisualSourceBadge } from '../ui';

// ── Motion Variants ─────────────────────────────────────

const listVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 260, damping: 24 },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: 0.15 },
  },
};

// ── Mood → Badge variant mapping ────────────────────────

function moodVariant(mood: string): 'gold' | 'teal' | 'green' | 'muted' {
  const lower = mood.toLowerCase();
  if (lower.includes('triumph') || lower.includes('glory') || lower.includes('discovery')) return 'gold';
  if (lower.includes('mystery') || lower.includes('tension') || lower.includes('conflict')) return 'teal';
  if (lower.includes('peace') || lower.includes('hope') || lower.includes('resolution')) return 'green';
  return 'muted';
}

// ── Streaming Text Display ──────────────────────────────

interface StreamingTextProps {
  text: string;
  isComplete: boolean;
}

const StreamingText = memo(function StreamingText({ text, isComplete }: StreamingTextProps) {
  const reducedMotion = useReducedMotion();
  const prevWordCountRef = useRef(0);

  const words = useMemo(() => text.split(/(\s+)/).filter(Boolean), [text]);

  // Track how many words were already rendered (so new ones animate in)
  useEffect(() => {
    // Update after render so the next batch knows the boundary
    const timer = requestAnimationFrame(() => {
      prevWordCountRef.current = words.length;
    });
    return () => cancelAnimationFrame(timer);
  }, [words.length]);

  if (reducedMotion || isComplete) {
    return (
      <p className="font-sans text-[13px] text-[var(--text)] leading-relaxed">
        {text}
      </p>
    );
  }

  const prevCount = prevWordCountRef.current;

  return (
    <p className="font-sans text-[13px] text-[var(--text)] leading-relaxed">
      {words.map((word, i) => {
        const isNew = i >= prevCount;
        if (!isNew) return <span key={i}>{word}</span>;
        return (
          <span
            key={i}
            className="inline-block"
            style={{
              animation: `word-appear 0.25s ease-out ${(i - prevCount) * 0.04}s both`,
            }}
          >
            {word}
          </span>
        );
      })}
      {!isComplete && (
        <span
          className="inline-block w-[2px] h-[14px] bg-[var(--gold)] ml-0.5 align-middle"
          style={{ animation: 'blink 0.8s step-end infinite' }}
        />
      )}
    </p>
  );
});

// ── Image Slot ──────────────────────────────────────────

interface ImageSlotProps {
  imageUrl: string | null;
  caption: string;
  title: string;
}

const ImageSlot = memo(function ImageSlot({ imageUrl, caption, title }: ImageSlotProps) {
  const reducedMotion = useReducedMotion();

  if (!imageUrl) {
    return (
      <div
        className="w-full aspect-[16/10] rounded-lg overflow-hidden bg-[var(--bg3)]"
        aria-label="Generating scene illustration"
      >
        <div
          className="w-full h-full"
          style={{
            background: 'linear-gradient(90deg, var(--bg3) 25%, var(--bg4) 50%, var(--bg3) 75%)',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s ease-in-out infinite',
          }}
        />
      </div>
    );
  }

  return (
    <motion.div
      className="w-full aspect-[16/10] rounded-lg overflow-hidden bg-[var(--bg3)]"
      initial={reducedMotion ? false : { opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
    >
      <img
        src={imageUrl}
        alt={caption || `Scene illustration for ${title}`}
        className="w-full h-full object-cover"
        loading="lazy"
      />
      {caption && (
        <div
          className="absolute bottom-0 left-0 right-0 px-3 py-2"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.6), transparent)' }}
        >
          <p className="font-sans text-[10px] text-white/80 leading-snug line-clamp-2">
            {caption}
          </p>
        </div>
      )}
    </motion.div>
  );
});

// ── Storyboard Frame Card ───────────────────────────────

interface StoryboardFrameCardProps {
  frame: StoryboardFrame;
  index: number;
}

const StoryboardFrameCard = memo(function StoryboardFrameCard({ frame, index }: StoryboardFrameCardProps) {
  const reducedMotion = useReducedMotion();
  const cardRef = useRef<HTMLDivElement>(null);
  const isComplete = frame.completedAt !== null;
  const fullText = frame.textChunks.join('');

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    cardRef.current.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    cardRef.current.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  }, []);

  return (
    <motion.div
      ref={cardRef}
      variants={cardVariants}
      onMouseMove={handleMouseMove}
      className="agent-card archival-frame relative rounded-lg border bg-[var(--bg2)] p-4 overflow-hidden transition-colors duration-500"
      style={{
        borderColor: isComplete ? 'rgba(139, 94, 26, 0.3)' : 'var(--bg4)',
      }}
      whileHover={reducedMotion ? undefined : { scale: 1.005 }}
      transition={{ type: 'spring', stiffness: 400, damping: 20 }}
    >
      {/* Header: index + title + source badge + mood badge */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="font-sans text-[10px] text-[var(--muted)] uppercase tracking-[0.15em] shrink-0"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {String(index + 1).padStart(2, '0')}
          </span>
          <h3 className="font-serif text-[18px] font-normal text-[var(--text)] leading-snug truncate">
            {frame.title}
          </h3>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <VisualSourceBadge
            source={fullText && frame.imageUrl ? 'interleaved' : 'composing'}
          />
          {frame.mood && (
            <Badge variant={moodVariant(frame.mood)}>{frame.mood}</Badge>
          )}
        </div>
      </div>

      {/* Two-column layout: text (left) + image (right) */}
      <div className="flex gap-4 flex-col sm:flex-row">
        {/* Left: streaming creative direction text */}
        <div className="flex-1 min-w-0">
          {fullText ? (
            <StreamingText text={fullText} isComplete={isComplete} />
          ) : (
            <p className="font-sans text-[13px] text-[var(--muted)] italic">
              Composing scene direction...
            </p>
          )}
        </div>

        {/* Right: image slot */}
        <div className="sm:w-[42%] shrink-0 relative">
          <ImageSlot
            imageUrl={frame.imageUrl}
            caption={frame.imageCaption}
            title={frame.title}
          />
        </div>
      </div>

      {/* Completion indicator — subtle gold line at bottom */}
      {isComplete && (
        <motion.div
          className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--gold)]"
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 0.4 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ transformOrigin: 'left' }}
        />
      )}
    </motion.div>
  );
});

// ── Main StoryboardStream ───────────────────────────────

export function StoryboardStream() {
  const storyboardFrames = useResearchStore((s) => s.storyboardFrames);
  const reducedMotion = useReducedMotion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Sort frames by their key (sceneId) for stable ordering
  const sortedFrames = useMemo(() => {
    const entries = Object.entries(storyboardFrames);
    // Sort by sceneId — typically scene_0, scene_1, etc.
    entries.sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
    return entries;
  }, [storyboardFrames]);

  // Auto-scroll to keep the latest incomplete frame in view
  useEffect(() => {
    if (reducedMotion) return;
    const el = bottomRef.current;
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [sortedFrames, reducedMotion]);

  // Count stats for the footer
  const completedCount = useMemo(
    () => sortedFrames.filter(([, f]) => f.completedAt !== null).length,
    [sortedFrames],
  );
  const hasImages = useMemo(
    () => sortedFrames.filter(([, f]) => f.imageUrl !== null).length,
    [sortedFrames],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 pt-5 pb-3 shrink-0">
        <h2
          className="text-[11px] font-serif uppercase tracking-[0.4em] text-[var(--gold)]"
          style={{ fontWeight: 400 }}
        >
          Storyboard
        </h2>
        {sortedFrames.length > 0 && (
          <p className="text-[10px] font-sans uppercase tracking-[0.2em] text-[var(--muted)] mt-1">
            {completedCount} of {sortedFrames.length} scenes composed
            {hasImages > 0 && (
              <>
                <span className="mx-1.5 opacity-40">&middot;</span>
                {hasImages} illustrated
              </>
            )}
          </p>
        )}
      </div>

      {/* Scrollable frame list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-5 pb-4"
        aria-live="polite"
        aria-label="Storyboard scenes"
      >
        {sortedFrames.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] opacity-60 animate-pulse" />
            <p className="text-[11px] text-[var(--muted)] font-sans uppercase tracking-[0.2em]">
              Awaiting storyboard...
            </p>
          </div>
        ) : (
          <motion.div
            variants={listVariants}
            initial="hidden"
            animate="show"
            className="space-y-4"
          >
            <AnimatePresence mode="popLayout">
              {sortedFrames.map(([sceneId, frame], i) => (
                <StoryboardFrameCard
                  key={sceneId}
                  frame={frame}
                  index={i}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
