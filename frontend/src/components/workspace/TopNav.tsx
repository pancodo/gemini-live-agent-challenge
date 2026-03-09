import { useEffect, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { Badge } from '../ui';

const STATUS_VARIANTS: Record<string, 'gold' | 'teal' | 'green' | 'muted' | 'red'> = {
  idle: 'muted',
  uploading: 'teal',
  processing: 'teal',
  ready: 'green',
  playing: 'gold',
};

export function TopNav() {
  const status = useSessionStore((s) => s.status);
  const gcsPath = useSessionStore((s) => s.gcsPath);
  const [elapsed, setElapsed] = useState(0);

  // Elapsed timer while processing
  useEffect(() => {
    if (status !== 'processing' && status !== 'uploading') return;
    const start = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [status]);

  // Extract filename from gcsPath
  const filename = gcsPath ? gcsPath.split('/').pop() ?? 'Document' : 'No document';

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <header
      className="sticky top-0 z-100 flex items-center justify-between h-[44px] px-5 bg-[var(--bg2)] border-b border-[var(--bg4)]"
      role="banner"
    >
      {/* Left: Logo */}
      <span
        className="text-[11px] uppercase tracking-[0.4em] text-[var(--gold-d)]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        AI Historian
      </span>

      {/* Center: Document name */}
      <div className="flex items-center gap-1.5 min-w-0 max-w-[40%]">
        <svg width="12" height="14" viewBox="0 0 12 14" fill="none" className="shrink-0 text-[var(--muted)]" aria-hidden="true">
          <path d="M2 1h6l3 3v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1" fill="none"/>
          <path d="M8 1v3h3" stroke="currentColor" strokeWidth="1" fill="none"/>
        </svg>
        <span className="text-[12px] text-[var(--muted)] font-sans truncate">
          {filename}
        </span>
      </div>

      {/* Right: Status + elapsed time */}
      <div className="flex items-center gap-3">
        <Badge variant={STATUS_VARIANTS[status] ?? 'muted'}>
          {status}
        </Badge>
        {(status === 'processing' || status === 'uploading') && (
          <span className="text-[10px] text-[var(--muted)] font-sans tabular-nums">
            {timeStr}
          </span>
        )}
      </div>
    </header>
  );
}
