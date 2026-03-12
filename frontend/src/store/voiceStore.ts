import { create } from 'zustand';
import type { VoiceState } from '../types';

const RESUME_TOKEN_KEY = 'historian_resume_token';

interface VoiceStore {
  state: VoiceState;
  resumeSegmentId: string | null;
  resumeOffset: number;
  resumptionToken: string | null;
  caption: string | null;
  userTranscript: string | null;
  /** Set by VoiceLayer — triggers voice connection + initial greeting */
  beginConsultation: (() => void) | null;
  setState: (state: VoiceState) => void;
  setResume: (segmentId: string, offset: number) => void;
  setResumptionToken: (token: string) => void;
  loadResumptionToken: () => void;
  clearResumptionToken: () => void;
  setCaption: (text: string) => void;
  setUserTranscript: (text: string | null) => void;
  setBeginConsultation: (fn: (() => void) | null) => void;
  clearResume: () => void;
}

export const useVoiceStore = create<VoiceStore>()((set) => ({
  state: 'idle',
  resumeSegmentId: null,
  resumeOffset: 0,
  resumptionToken: null,
  caption: null,
  userTranscript: null,
  beginConsultation: null,
  setState: (state) => set({ state }),
  setResume: (resumeSegmentId, resumeOffset) => set({ resumeSegmentId, resumeOffset }),
  setResumptionToken: (token) => {
    try { localStorage.setItem(RESUME_TOKEN_KEY, token); } catch { /* quota */ }
    set({ resumptionToken: token });
  },
  loadResumptionToken: () => {
    try {
      const token = localStorage.getItem(RESUME_TOKEN_KEY);
      if (token) set({ resumptionToken: token });
    } catch { /* private browsing */ }
  },
  clearResumptionToken: () => {
    try { localStorage.removeItem(RESUME_TOKEN_KEY); } catch { /* noop */ }
    set({ resumptionToken: null });
  },
  setCaption: (caption) => set({ caption }),
  setUserTranscript: (userTranscript) => set({ userTranscript }),
  setBeginConsultation: (fn) => set({ beginConsultation: fn }),
  clearResume: () => set({ resumeSegmentId: null, resumeOffset: 0, caption: null, userTranscript: null }),
}));
