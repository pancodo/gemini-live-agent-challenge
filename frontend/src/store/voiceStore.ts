import { create } from 'zustand';
import type { VoiceState } from '../types';

interface VoiceStore {
  state: VoiceState;
  resumeSegmentId: string | null;
  resumeOffset: number;
  setState: (state: VoiceState) => void;
  setResume: (segmentId: string, offset: number) => void;
  clearResume: () => void;
}

export const useVoiceStore = create<VoiceStore>()((set) => ({
  state: 'idle',
  resumeSegmentId: null,
  resumeOffset: 0,
  setState: (state) => set({ state }),
  setResume: (resumeSegmentId, resumeOffset) => set({ resumeSegmentId, resumeOffset }),
  clearResume: () => set({ resumeSegmentId: null, resumeOffset: 0 }),
}));
