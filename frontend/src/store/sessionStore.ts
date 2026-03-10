import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SessionStatus } from '../types';

interface SessionStore {
  sessionId: string | null;
  gcsPath: string | null;
  status: SessionStatus;
  language: string | null;
  visualBible: string | null;
  documentUrl: string | null;
  setSession: (partial: Partial<Omit<SessionStore, 'setSession' | 'reset'>>) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null,
  gcsPath: null,
  status: 'idle' as SessionStatus,
  language: null,
  visualBible: null,
  documentUrl: null,
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set) => ({
      ...initialState,
      setSession: (partial) => set(partial),
      reset: () => set(initialState),
    }),
    {
      name: 'ai-historian-session',
      // Only persist the identifiers — status is re-fetched from backend on load
      partialize: (state) => ({
        sessionId: state.sessionId,
        gcsPath: state.gcsPath,
        documentUrl: state.documentUrl,
        language: state.language,
      }),
    },
  ),
);
