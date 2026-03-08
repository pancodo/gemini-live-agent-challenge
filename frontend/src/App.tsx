import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { UploadPage } from './pages/UploadPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { PlayerPage } from './pages/PlayerPage';
import { useSessionStore } from './store/sessionStore';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 5000 } },
});

function WorkspaceGuard() {
  const sessionId = useSessionStore((s) => s.sessionId);
  return sessionId ? <WorkspacePage /> : <Navigate to="/" replace />;
}

function PlayerGuard() {
  const sessionId = useSessionStore((s) => s.sessionId);
  return sessionId ? <PlayerPage /> : <Navigate to="/workspace" replace />;
}

const router = createBrowserRouter([
  { path: '/', element: <UploadPage /> },
  { path: '/workspace', element: <WorkspaceGuard /> },
  { path: '/player/:segmentId', element: <PlayerGuard /> },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* Film grain overlay — always on */}
      <div className="grain-overlay" aria-hidden="true" />
      {/* Aurora blobs — shown on upload + workspace */}
      <div className="aurora-blob" aria-hidden="true" />
      <div className="aurora-blob" aria-hidden="true" />
      <div className="aurora-blob" aria-hidden="true" />
      <RouterProvider router={router} />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--bg2)',
            color: 'var(--text)',
            border: '1px solid var(--bg4)',
            fontFamily: 'var(--font-sans)',
            fontSize: '13px',
          },
        }}
      />
    </QueryClientProvider>
  );
}
