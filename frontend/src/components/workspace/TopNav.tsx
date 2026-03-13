import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useSessionStore } from '../../store/sessionStore';
import { useResearchStore } from '../../store/researchStore';
import { Badge } from '../ui';
import { useSettings } from '../../hooks/useSettings';
import { useTheme } from '../../hooks/useTheme';

const PHASE_NAMES: ReadonlyArray<{ phase: 1 | 2 | 3 | 4 | 5; label: string }> = [
  { phase: 1, label: 'Translation & Scan' },
  { phase: 2, label: 'Field Research' },
  { phase: 3, label: 'Synthesis' },
  { phase: 4, label: 'Visual Composition' },
  { phase: 5, label: 'Generation' },
] as const;

type DotState = 'done' | 'active' | 'pending';

function PhaseDot({ state }: { state: DotState }) {
  if (state === 'done') {
    return <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />;
  }
  if (state === 'active') {
    return <span className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] animate-pulse" />;
  }
  return <span className="w-1.5 h-1.5 rounded-full border border-[var(--muted)]/40" />;
}

// ── ElapsedTimer — isolated so 1s ticks don't re-render TopNav ──

const ElapsedTimer = memo(function ElapsedTimer({ status }: { status: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (status !== 'processing' && status !== 'uploading') return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [status]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return (
    <span className="text-[10px] text-[var(--muted)] font-sans tabular-nums">
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
});

const STATUS_VARIANTS: Record<string, 'gold' | 'teal' | 'green' | 'muted' | 'red'> = {
  idle: 'muted',
  uploading: 'teal',
  processing: 'teal',
  ready: 'green',
  playing: 'gold',
};

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}


function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`relative w-8 h-4 rounded-full transition-colors duration-200 cursor-pointer ${on ? 'bg-[var(--gold)]' : 'bg-[var(--bg4)]'}`}
    >
      <span
        className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-[left] duration-200 ${on ? 'left-[calc(100%-14px)]' : 'left-0.5'}`}
      />
    </button>
  );
}

export function TopNav() {
  const status = useSessionStore((s) => s.status);
  const gcsPath = useSessionStore((s) => s.gcsPath);
  const reset = useSessionStore((s) => s.reset);
  const activePhaseNum = useResearchStore(
    (s) => s.phases.length === 0 ? 0 : Math.max(...s.phases.map((p) => p.phase)),
  );

  const [settings, updateSetting] = useSettings();
  const { theme, setTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Apply reduced-motion class to document root
  useEffect(() => {
    if (settings.reducedMotion) {
      document.documentElement.classList.add('reduced-motion');
    } else {
      document.documentElement.classList.remove('reduced-motion');
    }
  }, [settings.reducedMotion]);

  // Close popover on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [settingsOpen]);

  const activePhaseEntry = PHASE_NAMES.find((p) => p.phase === activePhaseNum);
  const currentPhaseLabel = activePhaseEntry
    ? `Phase ${activePhaseNum === 1 ? 'I' : activePhaseNum === 2 ? 'II' : activePhaseNum === 3 ? 'III' : activePhaseNum === 4 ? 'IV' : 'V'} \u2014 ${activePhaseEntry.label}`
    : '';

  // Extract filename from gcsPath
  const filename = gcsPath ? gcsPath.split('/').pop() ?? 'Document' : 'No document';

  // Inline rename state
  const [isEditing, setIsEditing] = useState(false);
  const [docName, setDocName] = useState(filename);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync docName when gcsPath changes (new session)
  useEffect(() => {
    setDocName(filename);
  }, [filename]);

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    const trimmed = inputRef.current?.value.trim();
    if (trimmed) {
      setDocName(trimmed);
    }
    setIsEditing(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        handleSave();
      } else if (e.key === 'Escape') {
        setIsEditing(false);
        // Revert — docName stays unchanged since we never called setDocName
      }
    },
    [handleSave],
  );

  return (
    <div className="sticky top-0 z-100">
    <header
      className="flex items-center justify-between h-[44px] px-5 bg-[var(--bg2)] border-b border-[var(--bg4)]"
      role="banner"
    >
      {/* Left: Logo as home link */}
      <Link
        to="/"
        onClick={reset}
        className="text-[11px] uppercase tracking-[0.4em] text-[var(--gold-d)] no-underline hover:no-underline"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        AI Historian
      </Link>

      {/* Center: Editable document name */}
      <div
        className="group flex items-center gap-1.5 min-w-0 max-w-[40%] cursor-pointer"
        onClick={() => {
          if (!isEditing) setIsEditing(true);
        }}
      >
        <svg width="12" height="14" viewBox="0 0 12 14" fill="none" className="shrink-0 text-[var(--muted)]" aria-hidden="true">
          <path d="M2 1h6l3 3v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1" fill="none"/>
          <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1" fill="none"/>
        </svg>

        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            defaultValue={docName}
            onBlur={handleSave}
            onKeyDown={handleKeyDown}
            className="text-[12px] text-[var(--muted)] font-sans truncate bg-transparent outline-none border-b border-[var(--gold)]/40 min-w-0 w-full"
            aria-label="Rename document"
          />
        ) : (
          <>
            <span className="text-[12px] text-[var(--muted)] font-sans truncate">
              {docName}
            </span>
            {/* Pencil icon — visible on hover */}
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              className="shrink-0 opacity-0 group-hover:opacity-60 transition-opacity duration-150 text-[var(--muted)]"
              aria-hidden="true"
            >
              <path
                d="M7.5 1.5l1 1-5.5 5.5H2V7L7.5 1.5z"
                stroke="currentColor"
                strokeWidth="0.8"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </>
        )}
      </div>

      {/* Right: Theme toggle + Settings + Status + elapsed time */}
      <div className="flex items-center gap-3">
        {/* Single-click theme toggle */}
        <button
          type="button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="flex items-center justify-center w-7 h-7 rounded text-[var(--muted)] hover:text-[var(--gold-d)] hover:bg-[var(--bg3)] transition-colors duration-150 cursor-pointer"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </button>
        <div ref={settingsRef} className="relative">
          <button
            type="button"
            onClick={() => setSettingsOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[var(--muted)] hover:text-[var(--gold-d)] hover:bg-[var(--bg3)] transition-colors duration-150 cursor-pointer"
            aria-label="Settings"
            aria-expanded={settingsOpen}
          >
            <GearIcon />
            <span className="font-sans text-[11px] uppercase tracking-[0.15em]">Settings</span>
          </button>
          {settingsOpen && (
            <div className="absolute right-0 top-[calc(100%+8px)] bg-[var(--bg2)] border border-[var(--bg4)] rounded-lg py-2 w-56 z-50 shadow-md">
              {/* Header */}
              <div className="px-3 pb-2 border-b border-[var(--bg4)]">
                <span className="font-sans text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Settings</span>
              </div>

              {/* Playback section */}
              <div className="px-3 pt-2 pb-1">
                <span className="font-sans text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]/60">Playback</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <div>
                  <span className="font-sans text-[12px] text-[var(--text)]">Auto-watch</span>
                  <p className="font-sans text-[10px] text-[var(--muted)] leading-tight">Open player when ready</p>
                </div>
                <Toggle on={settings.autoWatch} onToggle={() => updateSetting('autoWatch', !settings.autoWatch)} />
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <div>
                  <span className="font-sans text-[12px] text-[var(--text)]">Captions</span>
                  <p className="font-sans text-[10px] text-[var(--muted)] leading-tight">Show narration text</p>
                </div>
                <Toggle on={settings.showCaptions} onToggle={() => updateSetting('showCaptions', !settings.showCaptions)} />
              </div>

              {/* Divider */}
              <div className="mx-3 my-1.5 border-t border-[var(--bg4)]" />

              {/* Voice section */}
              <div className="px-3 pb-1">
                <span className="font-sans text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]/60">Voice</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <div>
                  <span className="font-sans text-[12px] text-[var(--text)]">Historian voice</span>
                  <p className="font-sans text-[10px] text-[var(--muted)] leading-tight">Enable live conversation</p>
                </div>
                <Toggle on={settings.voiceEnabled} onToggle={() => updateSetting('voiceEnabled', !settings.voiceEnabled)} />
              </div>

              {/* Divider */}
              <div className="mx-3 my-1.5 border-t border-[var(--bg4)]" />

              {/* Accessibility section */}
              <div className="px-3 pb-1">
                <span className="font-sans text-[9px] uppercase tracking-[0.2em] text-[var(--muted)]/60">Accessibility</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <div>
                  <span className="font-sans text-[12px] text-[var(--text)]">Reduced motion</span>
                  <p className="font-sans text-[10px] text-[var(--muted)] leading-tight">Disable animations</p>
                </div>
                <Toggle on={settings.reducedMotion} onToggle={() => updateSetting('reducedMotion', !settings.reducedMotion)} />
              </div>
            </div>
          )}
        </div>
        <Badge variant={STATUS_VARIANTS[status] ?? 'muted'}>
          {status}
        </Badge>
        {(status === 'processing' || status === 'uploading') && (
          <ElapsedTimer status={status} />
        )}
      </div>
    </header>
    <AnimatePresence>
      {status === 'processing' && activePhaseNum > 0 && (
        <motion.div
          key="phase-indicator"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3 }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-2 px-5 py-1.5 bg-[var(--bg2)] border-b border-[var(--bg4)]">
            {PHASE_NAMES.map((p) => {
              let state: DotState = 'pending';
              if (p.phase < activePhaseNum) state = 'done';
              else if (p.phase === activePhaseNum) state = 'active';
              return <PhaseDot key={p.phase} state={state} />;
            })}
            <span className="font-sans text-[10px] text-[var(--muted)] uppercase tracking-[0.15em] ml-2">
              {currentPhaseLabel}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}
