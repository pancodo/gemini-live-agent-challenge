import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// Dev-only: expose stores on window for console seeding
if (import.meta.env.DEV) {
  import('./store/sessionStore').then(({ useSessionStore }) => {
    (window as unknown as Record<string, unknown>).__sessionStore = useSessionStore;
  });
  import('./store/researchStore').then(({ useResearchStore }) => {
    (window as unknown as Record<string, unknown>).__researchStore = useResearchStore;
  });
  import('./store/playerStore').then(({ usePlayerStore }) => {
    (window as unknown as Record<string, unknown>).__playerStore = usePlayerStore;
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
