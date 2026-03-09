import { Navigate } from 'react-router-dom';
import { TopNav } from '../components/workspace/TopNav';
import { WorkspaceLayout } from '../components/workspace/WorkspaceLayout';
import { ResearchPanel } from '../components/workspace/ResearchPanel';
import { ExpeditionLog } from '../components/workspace/ExpeditionLog';
import { useSessionStore } from '../store/sessionStore';
import { useSession } from '../hooks/useSession';

export function WorkspacePage() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const status = useSessionStore((s) => s.status);
  useSession(sessionId);

  if (!sessionId) return <Navigate to="/" replace />;

  return (
    <>
      <TopNav />
      <WorkspaceLayout>
        {/* Right panel — content switches on session status */}
        <div className="flex flex-col h-full">
          {status === 'processing' && <ExpeditionLog />}

          {(status === 'ready' || status === 'playing') && (
            <div className="h-full overflow-y-auto">
              <ResearchPanel />
            </div>
          )}

          {(status === 'idle' || status === 'uploading') && (
            <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] opacity-60 animate-pulse" />
              <p className="text-[11px] text-[var(--muted)] font-sans uppercase tracking-[0.2em]">
                Preparing document…
              </p>
            </div>
          )}
        </div>
      </WorkspaceLayout>
    </>
  );
}
