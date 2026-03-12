import { create } from 'zustand';

import type { BranchNode, LiveIllustration } from '../types';

interface PlayerStore {
  isOpen: boolean;
  currentSegmentId: string | null;
  playbackOffset: number;
  captionText: string;
  isKenBurnsPaused: boolean;
  isIdle: boolean;
  open: (segmentId: string) => void;
  close: () => void;
  setCaption: (text: string) => void;
  setKenBurnsPaused: (paused: boolean) => void;
  setIdle: (idle: boolean) => void;
  setPlaybackOffset: (offset: number) => void;
  irisTargetPath: string | null;
  triggerIris: (path: string) => void;
  clearIris: () => void;
  branchGraph: BranchNode[];
  activeBranchId: string | null;
  addBranchNode: (node: BranchNode) => void;
  setActiveBranch: (segmentId: string | null) => void;
  liveIllustration: LiveIllustration | null;
  _illustrationTimer: ReturnType<typeof setTimeout> | null;
  setLiveIllustration: (ill: LiveIllustration | null) => void;
}

export const usePlayerStore = create<PlayerStore>()((set) => ({
  isOpen: false,
  currentSegmentId: null,
  playbackOffset: 0,
  captionText: '',
  isKenBurnsPaused: false,
  isIdle: false,
  open: (segmentId) => set({ isOpen: true, currentSegmentId: segmentId, isIdle: false }),
  close: () => set({ isOpen: false, currentSegmentId: null, playbackOffset: 0, captionText: '' }),
  setCaption: (captionText) => set({ captionText }),
  setKenBurnsPaused: (isKenBurnsPaused) => set({ isKenBurnsPaused }),
  setIdle: (isIdle) => set({ isIdle }),
  setPlaybackOffset: (playbackOffset) => set({ playbackOffset }),
  irisTargetPath: null,
  triggerIris: (irisTargetPath) => set({ irisTargetPath }),
  clearIris: () => set({ irisTargetPath: null }),
  branchGraph: [],
  activeBranchId: null,
  addBranchNode: (node) =>
    set((state) => ({ branchGraph: [...state.branchGraph, node] })),
  setActiveBranch: (segmentId) => set({ activeBranchId: segmentId }),
  liveIllustration: null,
  _illustrationTimer: null,
  setLiveIllustration: (ill) => {
    set((state) => {
      // Clear existing timer
      if (state._illustrationTimer) {
        clearTimeout(state._illustrationTimer);
      }

      if (ill) {
        // Auto-clear after 25 seconds
        const timer = setTimeout(() => {
          set({ liveIllustration: null, _illustrationTimer: null });
        }, 25_000);
        return { liveIllustration: ill, _illustrationTimer: timer };
      }

      return { liveIllustration: null, _illustrationTimer: null };
    });
  },
}));
