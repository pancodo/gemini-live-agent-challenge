import { create } from 'zustand';
import type { SessionStatus } from '../types';

interface SessionStore {
  sessionId: string | null;
  gcsPath: string | null;
  status: SessionStatus;
  language: string | null;
  visualBible: string | null;
  setSession: (partial: Partial<Omit<SessionStore, 'setSession' | 'reset'>>) => void;
  reset: () => void;
}

const initialState = {
  sessionId: null,
  gcsPath: null,
  status: 'idle' as SessionStatus,
  language: null,
  visualBible: null,
};

export const useSessionStore = create<SessionStore>()((set) => ({
  ...initialState,
  setSession: (partial) => set(partial),
  reset: () => set(initialState),
}));
