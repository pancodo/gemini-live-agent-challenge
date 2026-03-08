import { create } from 'zustand';
import type { VoiceState } from '../types';

interface VoiceStore {
  state: VoiceState;
  resumeSegmentId: string | null;
  resumeOffset: number;
  resumptionToken: string | null;
  setState: (state: VoiceState) => void;
  setResume: (segmentId: string, offset: number) => void;
  setResumptionToken: (token: string) => void;
  clearResume: () => void;
}

export const useVoiceStore = create<VoiceStore>()((set) => ({
  state: 'idle',
  resumeSegmentId: null,
  resumeOffset: 0,
  resumptionToken: null,
  setState: (state) => set({ state }),
  setResume: (resumeSegmentId, resumeOffset) => set({ resumeSegmentId, resumeOffset }),
  setResumptionToken: (token) => set({ resumptionToken: token }),
  clearResume: () => set({ resumeSegmentId: null, resumeOffset: 0, resumptionToken: null }),
}));
