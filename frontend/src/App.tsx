import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { UploadPage } from './pages/UploadPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { PlayerPage } from './pages/PlayerPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { useSessionStore } from './store/sessionStore';
import { VoiceLayer } from './components/voice/VoiceLayer';
import { IrisOverlay } from './components/player/IrisOverlay';
import { TopNav } from './components/workspace/TopNav';

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

function RootLayout() {
  const location = useLocation();
  const isPlayer = location.pathname.startsWith('/player');

  return (
    <>
      {!isPlayer && <TopNav />}
      <Outlet />
      <VoiceLayer />
      <IrisOverlay />
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <UploadPage /> },
      { path: '/workspace', element: <WorkspaceGuard /> },
      { path: '/player/:segmentId', element: <PlayerGuard /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
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
