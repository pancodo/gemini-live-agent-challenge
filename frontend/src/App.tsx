import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useSessionStore } from './store/sessionStore';
import { VoiceLayer } from './components/voice/VoiceLayer';
import { IrisOverlay } from './components/player/IrisOverlay';
import { TopNav } from './components/workspace/TopNav';

const UploadPage = lazy(() =>
  import('./pages/UploadPage').then((m) => ({ default: m.UploadPage })),
);
const WorkspacePage = lazy(() =>
  import('./pages/WorkspacePage').then((m) => ({ default: m.WorkspacePage })),
);
const PlayerPage = lazy(() =>
  import('./pages/PlayerPage').then((m) => ({ default: m.PlayerPage })),
);
const NotFoundPage = lazy(() =>
  import('./pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 5000 } },
});

function PageFallback() {
  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <span className="block w-2 h-2 rounded-full bg-[var(--gold)] opacity-60 animate-pulse" />
        <p className="text-[11px] text-[var(--muted)] font-sans uppercase tracking-[0.2em]">
          Loading&hellip;
        </p>
      </div>
    </div>
  );
}

function WorkspaceGuard() {
  const sessionId = useSessionStore((s) => s.sessionId);
  return sessionId ? (
    <Suspense fallback={<PageFallback />}>
      <WorkspacePage />
    </Suspense>
  ) : (
    <Navigate to="/" replace />
  );
}

function PlayerGuard() {
  const sessionId = useSessionStore((s) => s.sessionId);
  return sessionId ? (
    <Suspense fallback={<PageFallback />}>
      <PlayerPage />
    </Suspense>
  ) : (
    <Navigate to="/workspace" replace />
  );
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
      {
        path: '/',
        element: (
          <Suspense fallback={<PageFallback />}>
            <UploadPage />
          </Suspense>
        ),
      },
      { path: '/workspace', element: <WorkspaceGuard /> },
      { path: '/player/:segmentId', element: <PlayerGuard /> },
      {
        path: '*',
        element: (
          <Suspense fallback={<PageFallback />}>
            <NotFoundPage />
          </Suspense>
        ),
      },
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
