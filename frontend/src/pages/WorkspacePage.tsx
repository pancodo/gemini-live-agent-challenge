import { TopNav } from '../components/workspace/TopNav';
import { WorkspaceLayout } from '../components/workspace/WorkspaceLayout';
import { useSessionStore } from '../store/sessionStore';
import { useSession } from '../hooks/useSession';

export function WorkspacePage() {
  const sessionId = useSessionStore((s) => s.sessionId);
  useSession(sessionId);

  return (
    <>
      <TopNav />
      <WorkspaceLayout>
        {/* Agent 3 will replace this div with ResearchPanel */}
        <div className="p-6" style={{ fontFamily: 'var(--font-serif)' }}>
          <p className="text-[var(--muted)]">
            Research Activity — initializing...
          </p>
        </div>
      </WorkspaceLayout>
    </>
  );
}
