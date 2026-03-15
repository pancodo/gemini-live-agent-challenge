import { lazy, Suspense, useEffect, useRef } from 'react';
import { createBrowserRouter, RouterProvider, Navigate, Outlet, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { useSessionStore } from './store/sessionStore';
import { VoiceLayer } from './components/voice/VoiceLayer';
import { IrisOverlay } from './components/player/IrisOverlay';
import { TopNav } from './components/workspace/TopNav';
import { useTheme } from './hooks/useTheme';
import { AccessGate } from './components/ui/AccessGate';

const LandingPage = lazy(() =>
  import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })),
);
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
const TestMapPage = lazy(() =>
  import('./pages/TestMapPage').then((m) => ({ default: m.TestMapPage })),
);
const InterleavedDemoPage = lazy(() =>
  import('./pages/InterleavedDemoPage').then((m) => ({ default: m.InterleavedDemoPage })),
);

function ThemeSync() {
  useTheme();
  return null;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
    },
  },
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
    <Navigate to="/app" replace />
  );
}

function PlayerGuard() {
  const sessionId = useSessionStore((s) => s.sessionId);
  return sessionId ? (
    <Suspense fallback={<PageFallback />}>
      <PlayerPage />
    </Suspense>
  ) : (
    <Navigate to="/app" replace />
  );
}

function RootLayout() {
  const location = useLocation();
  const isPlayer = location.pathname.startsWith('/player');

  return (
    <AccessGate>
      <div className={isPlayer ? '' : 'flex flex-col h-screen'}>
        {!isPlayer && <TopNav />}
        <div className={isPlayer ? '' : 'flex-1 min-h-0'}>
          <Outlet />
        </div>
      </div>
      <VoiceLayer />
      <IrisOverlay />
    </AccessGate>
  );
}

const router = createBrowserRouter([
  // Landing page — standalone, no app chrome
  {
    path: '/',
    element: (
      <Suspense fallback={<PageFallback />}>
        <LandingPage />
      </Suspense>
    ),
  },
  // App routes — with TopNav, VoiceLayer, IrisOverlay
  {
    element: <RootLayout />,
    children: [
      {
        path: '/app',
        element: (
          <Suspense fallback={<PageFallback />}>
            <UploadPage />
          </Suspense>
        ),
      },
      { path: '/workspace', element: <WorkspaceGuard /> },
      { path: '/player/:segmentId', element: <PlayerGuard /> },
      {
        path: '/demo/interleaved',
        element: (
          <Suspense fallback={<PageFallback />}>
            <InterleavedDemoPage />
          </Suspense>
        ),
      },
      ...(import.meta.env.DEV ? [{
        path: '/test-map',
        element: (
          <Suspense fallback={<PageFallback />}>
            <TestMapPage />
          </Suspense>
        ),
      }] : []),
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

/** Static canvas noise — replaces feTurbulence SVG filter (same look, ~0% GPU). */
function GrainOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const render = () => {
      const c = canvasRef.current;
      if (!c) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const img = ctx.createImageData(w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    };
    render();
    window.addEventListener('resize', render);
    return () => window.removeEventListener('resize', render);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="grain-overlay"
    />
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeSync />
      {/* Film grain overlay — static canvas noise, no SVG filter cost */}
      <GrainOverlay />
      {/* Aurora blobs — parchment screens; invisible on dark landing bg */}
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
