import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useSessionStore } from '../../store/sessionStore';
import { useResearchStore } from '../../store/researchStore';
import { uploadDocument } from '../../services/upload';
import { InkButton } from '../ui';
import { FormatBadge } from './FormatBadge';

type DropState = 'idle' | 'drag-active' | 'uploading' | 'error';

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
];

const spring = { type: 'spring' as const, stiffness: 400, damping: 17 };

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DropZone() {
  const navigate = useNavigate();
  const setSession = useSessionStore((s) => s.setSession);
  const resetResearch = useResearchStore((s) => s.reset);
  const shouldReduceMotion = useReducedMotion();

  const [dropState, setDropState] = useState<DropState>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [language, setLanguage] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  const handleFile = useCallback(
    async (file: File) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setDropState('error');
        setErrorMsg(
          `Unsupported format: ${file.type || 'unknown'}. Use PDF, JPG, PNG, TIFF, or WEBP.`
        );
        return;
      }

      setSelectedFile(file);
      setDropState('uploading');
      setProgress(0);
      setErrorMsg('');

      // Prefetch workspace chunk while upload is in progress
      import('../../pages/WorkspacePage').catch(() => {});

      try {
        const { sessionId, gcsPath } = await uploadDocument(
          file,
          language || undefined,
          (pct) => setProgress(pct)
        );

        resetResearch();
        setSession({
          sessionId,
          gcsPath,
          status: 'processing',
        });

        navigate('/workspace');
      } catch (err) {
        setDropState('error');
        setErrorMsg(
          err instanceof Error ? err.message : 'Upload failed. Please try again.'
        );
      }
    },
    [language, navigate, setSession, resetResearch]
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setDropState('drag-active');
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDropState('idle');
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFile(file);
      }
    },
    [handleFile]
  );

  const handleReset = useCallback(() => {
    setDropState('idle');
    setErrorMsg('');
    setSelectedFile(null);
    setProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const borderClass =
    dropState === 'drag-active'
      ? 'border-solid border-[var(--gold)]'
      : dropState === 'error'
        ? 'border-dashed border-red-400'
        : 'border-dashed border-[var(--gold)]/40';

  return (
    <motion.div
      className={`archival-frame relative w-full max-w-xl rounded-xl p-8 ${borderClass} border bg-[var(--bg2)]/60 backdrop-blur-sm cursor-pointer select-none`}
      animate={{
        scale: dropState === 'drag-active' && !shouldReduceMotion ? 1.02 : 1,
      }}
      transition={spring}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => {
        if (dropState === 'idle') inputRef.current?.click();
      }}
      role="button"
      tabIndex={0}
      aria-label="Upload a historical document"
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (dropState === 'idle') inputRef.current?.click();
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.tiff,.tif,.webp"
        onChange={handleInputChange}
        className="hidden"
        aria-hidden="true"
      />

      <AnimatePresence mode="wait">
        {/* Idle + Drag-Active state */}
        {(dropState === 'idle' || dropState === 'drag-active') && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
            className="flex flex-col items-center gap-5"
          >
            {/* Scroll/manuscript SVG icon */}
            <svg
              width="56"
              height="56"
              viewBox="0 0 56 56"
              fill="none"
              className="text-[var(--gold)] opacity-60"
              aria-hidden="true"
            >
              <path
                d="M12 8C12 6.89543 12.8954 6 14 6H38L44 12V44C44 45.1046 43.1046 46 42 46H14C12.8954 46 12 45.1046 12 44V8Z"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
              />
              <path
                d="M38 6V12H44"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
              />
              <line
                x1="18"
                y1="20"
                x2="38"
                y2="20"
                stroke="currentColor"
                strokeWidth="1"
                opacity="0.5"
              />
              <line
                x1="18"
                y1="26"
                x2="36"
                y2="26"
                stroke="currentColor"
                strokeWidth="1"
                opacity="0.4"
              />
              <line
                x1="18"
                y1="32"
                x2="34"
                y2="32"
                stroke="currentColor"
                strokeWidth="1"
                opacity="0.3"
              />
              <line
                x1="18"
                y1="38"
                x2="30"
                y2="38"
                stroke="currentColor"
                strokeWidth="1"
                opacity="0.2"
              />
            </svg>

            <div className="text-center">
              <p
                className="text-[22px] text-[var(--text)]"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                {dropState === 'drag-active'
                  ? 'Release to upload'
                  : 'Drop any historical document'}
              </p>
              <p className="mt-1 text-[13px] text-[var(--muted)] font-sans">
                or click to browse
              </p>
            </div>

            <FormatBadge />

            {/* Language input */}
            <div className="w-full max-w-xs" onClick={(e) => e.stopPropagation()}>
              <label
                htmlFor="language-input"
                className="block text-[10px] uppercase tracking-[0.15em] text-[var(--muted)] font-sans mb-1 text-center"
              >
                Document language (optional)
              </label>
              <input
                id="language-input"
                type="text"
                value={language}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setLanguage(e.target.value)
                }
                placeholder="e.g. Ottoman Turkish, Latin, Arabic"
                className="w-full px-3 py-1.5 rounded-md border border-[var(--bg4)] bg-[var(--bg)] text-[13px] text-[var(--text)] font-sans placeholder:text-[var(--muted)]/60 focus:outline-none focus:ring-1 focus:ring-[var(--gold)]/40"
              />
            </div>

            <p className="text-[11px] text-[var(--muted)]/80 font-sans text-center leading-relaxed max-w-sm">
              Supports all languages including Arabic, Persian, Ottoman Turkish,
              Latin, Greek, Cyrillic
            </p>
          </motion.div>
        )}

        {/* Uploading state */}
        {dropState === 'uploading' && (
          <motion.div
            key="uploading"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
            className="flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className="text-[18px] text-[var(--text)]"
              style={{ fontFamily: 'var(--font-serif)' }}
            >
              Uploading document...
            </p>

            {selectedFile && (
              <p className="text-[12px] text-[var(--muted)] font-sans">
                {selectedFile.name} ({formatFileSize(selectedFile.size)})
              </p>
            )}

            {/* Progress bar */}
            <div className="w-full max-w-xs h-2 rounded-full bg-[var(--bg4)] overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-[var(--gold)]"
                initial={{ width: '0%' }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </div>
            <p className="text-[11px] text-[var(--muted)] font-sans tabular-nums">
              {progress}%
            </p>
          </motion.div>
        )}

        {/* Error state */}
        {dropState === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: shouldReduceMotion ? 0 : 0.2 }}
            className="flex flex-col items-center gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Error icon */}
            <svg
              width="40"
              height="40"
              viewBox="0 0 40 40"
              fill="none"
              className="text-red-500"
              aria-hidden="true"
            >
              <circle
                cx="20"
                cy="20"
                r="16"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <line
                x1="14"
                y1="14"
                x2="26"
                y2="26"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <line
                x1="26"
                y1="14"
                x2="14"
                y2="26"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>

            <p className="text-[14px] text-red-600 font-sans text-center max-w-sm">
              {errorMsg}
            </p>

            <InkButton onClick={handleReset} className="text-sm">
              Try Again
            </InkButton>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
