import { motion } from 'motion/react';
import { useClipGeneration } from '../../hooks/useClipGeneration';

interface ShareButtonProps {
  sessionId: string | null;
  segmentId: string | null;
}

/** Share/download icon — arrow-up-from-box */
function ShareIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 9V2" />
      <path d="M4 4.5L7 1.5L10 4.5" />
      <path d="M12 9v2.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9" />
    </svg>
  );
}

/** Download icon — arrow-down-to-line */
function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 2v7" />
      <path d="M4 6.5L7 9.5L10 6.5" />
      <line x1="2" y1="12.5" x2="12" y2="12.5" />
    </svg>
  );
}

/** Spinner — rotating circle segment */
function Spinner() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      style={{ animation: 'spin 1s linear infinite' }}
    >
      <path d="M7 1a6 6 0 0 1 6 6" />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </svg>
  );
}

export function ShareButton({ sessionId, segmentId }: ShareButtonProps) {
  const { clipStatus, generateClip } = useClipGeneration(sessionId);

  const isGenerating =
    clipStatus?.status === 'generating' || clipStatus?.status === 'queued';
  const isReady = clipStatus?.status === 'ready';

  const handleClick = () => {
    if (!segmentId || isGenerating) return;

    if (isReady && clipStatus?.downloadUrl) {
      // Re-download
      const a = document.createElement('a');
      a.href = clipStatus.downloadUrl;
      a.download = `ai-historian-clip-${segmentId}.mp4`;
      a.click();
      return;
    }

    generateClip(segmentId);
  };

  let label = 'Share Clip';
  let icon = <ShareIcon />;
  if (isGenerating) {
    label = 'Generating...';
    icon = <Spinner />;
  } else if (isReady) {
    label = 'Download';
    icon = <DownloadIcon />;
  }

  return (
    <motion.button
      onClick={handleClick}
      disabled={isGenerating || !segmentId}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      className="flex items-center gap-2 transition-colors duration-200"
      style={{
        fontFamily: 'var(--font-sans)',
        fontWeight: 400,
        fontSize: 11,
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        color: isGenerating
          ? 'rgba(232,221,208,0.3)'
          : 'rgba(232,221,208,0.5)',
        background: 'transparent',
        border: 'none',
        cursor: isGenerating ? 'wait' : 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!isGenerating) {
          e.currentTarget.style.color = 'var(--glow-primary)';
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = isGenerating
          ? 'rgba(232,221,208,0.3)'
          : 'rgba(232,221,208,0.5)';
      }}
      aria-label={label}
    >
      {icon}
      {label}
    </motion.button>
  );
}
