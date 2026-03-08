import { Navigate } from 'react-router-dom';
import { TopNav } from '../components/workspace/TopNav';
import { WorkspaceLayout } from '../components/workspace/WorkspaceLayout';
import { HistorianPanel } from '../components/workspace';
import { useSessionStore } from '../store/sessionStore';
import { useSession } from '../hooks/useSession';

export function WorkspacePage() {
  const sessionId = useSessionStore((s) => s.sessionId);
  useSession(sessionId);

  if (!sessionId) return <Navigate to="/" replace />;

  return (
    <>
      <TopNav />
      <WorkspaceLayout>
        {/* Right panel stack */}
        <div className="flex flex-col gap-4 p-4">
          <HistorianPanel />
          {/* Part 3: ResearchPanel replaces this placeholder */}
          <div className="p-4 rounded-lg border border-[var(--bg4)] bg-[var(--bg2)]/40">
            <p className="text-[12px] text-[var(--muted)] font-sans uppercase tracking-[0.15em]">
              Research Activity — initializing…
            </p>
          </div>
        </div>
      </WorkspaceLayout>
    </>
  );
}
