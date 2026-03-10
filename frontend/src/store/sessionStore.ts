import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SessionStatus } from '../types';

export interface RecentSession {
  sessionId: string;
  label: string;
  status: SessionStatus;
  createdAt: number;
  gcsPath: string | null;
  language: string | null;
}

interface SessionStore {
  sessionId: string | null;
  gcsPath: string | null;
  status: SessionStatus;
  language: string | null;
  visualBible: string | null;
  documentUrl: string | null;
  recentSessions: RecentSession[];
  setSession: (partial: Partial<Omit<SessionStore, 'setSession' | 'reset' | 'renameSession' | 'recentSessions'>>) => void;
  renameSession: (sessionId: string, label: string) => void;
  reset: () => void;
}

function deriveLabel(gcsPath: string | null): string {
  if (!gcsPath) return 'Document';
  const parts = gcsPath.split('/');
  return parts.pop() || 'Document';
}

const initialState = {
  sessionId: null as string | null,
  gcsPath: null as string | null,
  status: 'idle' as SessionStatus,
  language: null as string | null,
  visualBible: null as string | null,
  documentUrl: null as string | null,
  recentSessions: [] as RecentSession[],
};

export const useSessionStore = create<SessionStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      setSession: (partial) => {
        const current = get();
        const incomingId = partial.sessionId;

        // If a new sessionId is being set, prepend to recentSessions
        if (incomingId && incomingId !== current.sessionId) {
          const gcsPath = partial.gcsPath ?? current.gcsPath;
          const language = partial.language ?? current.language;
          const status = partial.status ?? current.status;

          const entry: RecentSession = {
            sessionId: incomingId,
            label: deriveLabel(gcsPath),
            status,
            createdAt: Date.now(),
            gcsPath,
            language,
          };

          const filtered = current.recentSessions.filter(
            (s) => s.sessionId !== incomingId
          );
          const updated = [entry, ...filtered].slice(0, 5);
          set({ ...partial, recentSessions: updated });
        } else {
          set(partial);
        }
      },
      renameSession: (sessionId, label) => {
        const current = get();
        set({
          recentSessions: current.recentSessions.map((s) =>
            s.sessionId === sessionId ? { ...s, label } : s
          ),
        });
      },
      reset: () => set({ ...initialState, recentSessions: get().recentSessions }),
    }),
    {
      name: 'ai-historian-session',
      // Only persist the identifiers — status is re-fetched from backend on load
      partialize: (state) => ({
        sessionId: state.sessionId,
        gcsPath: state.gcsPath,
        documentUrl: state.documentUrl,
        language: state.language,
        recentSessions: state.recentSessions,
      }),
    },
  ),
);
