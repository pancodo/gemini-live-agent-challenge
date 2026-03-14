import { create } from 'zustand';
import { toast } from 'sonner';

import type { BranchNode, LiveIllustration, MapViewMode, SegmentGeo } from '../types';

let _illustrationTimerHandle: ReturnType<typeof setTimeout> | null = null;

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
  setLiveIllustration: (ill: LiveIllustration | null) => void;
  /** True when user is in voice conversation with historian (not during narration) */
  isConversationMode: boolean;
  setConversationMode: (mode: boolean) => void;
  /** Geographic metadata per segment, keyed by segmentId */
  segmentGeo: Record<string, SegmentGeo>;
  setSegmentGeo: (segmentId: string, geo: SegmentGeo) => void;
  /** Current map view mode in the documentary player */
  mapViewMode: MapViewMode;
  setMapViewMode: (mode: MapViewMode) => void;
  /** True when the entire research+generation pipeline has finished */
  pipelineComplete: boolean;
  setPipelineComplete: (complete: boolean) => void;
  /** Words-per-second rate for caption stagger timing */
  captionWps: number;
  setCaptionWps: (wps: number) => void;
}

export const usePlayerStore = create<PlayerStore>()((set) => ({
  isOpen: false,
  currentSegmentId: null,
  playbackOffset: 0,
  captionText: '',
  isKenBurnsPaused: false,
  isIdle: false,
  open: (segmentId) => set({ isOpen: true, currentSegmentId: segmentId, isIdle: false }),
  close: () => set({ isOpen: false, currentSegmentId: null, playbackOffset: 0, captionText: '', segmentGeo: {}, pipelineComplete: false }),
  setCaption: (captionText) => set({ captionText }),
  setKenBurnsPaused: (isKenBurnsPaused) => set({ isKenBurnsPaused }),
  setIdle: (isIdle) => set({ isIdle }),
  setPlaybackOffset: (playbackOffset) => set({ playbackOffset }),
  irisTargetPath: null,
  triggerIris: (irisTargetPath) => set({ irisTargetPath }),
  clearIris: () => set({ irisTargetPath: null }),
  branchGraph: [],
  activeBranchId: null,
  addBranchNode: (node) => {
    set((state) => ({ branchGraph: [...state.branchGraph, node] }));
    toast('New chapter created', {
      description: node.triggerQuestion,
      duration: 5000,
      action: {
        label: 'Go to chapter',
        onClick: () => usePlayerStore.getState().open(node.segmentId),
      },
    });
  },
  setActiveBranch: (segmentId) => set({ activeBranchId: segmentId }),
  isConversationMode: false,
  setConversationMode: (isConversationMode) => set({ isConversationMode }),
  segmentGeo: {},
  setSegmentGeo: (segmentId, geo) =>
    set((state) => ({ segmentGeo: { ...state.segmentGeo, [segmentId]: geo } })),
  mapViewMode: 'ken-burns',
  setMapViewMode: (mapViewMode) => set({ mapViewMode }),
  pipelineComplete: false,
  setPipelineComplete: (pipelineComplete) => set({ pipelineComplete }),
  captionWps: 0,
  setCaptionWps: (captionWps) => set({ captionWps }),
  liveIllustration: null,
  setLiveIllustration: (ill) => {
    if (_illustrationTimerHandle !== null) {
      clearTimeout(_illustrationTimerHandle);
      _illustrationTimerHandle = null;
    }
    if (ill) {
      _illustrationTimerHandle = setTimeout(() => {
        _illustrationTimerHandle = null;
        set({ liveIllustration: null });
      }, 35_000);
    }
    set({ liveIllustration: ill ?? null });
  },
}));
