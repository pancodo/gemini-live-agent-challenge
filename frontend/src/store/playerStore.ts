import { create } from 'zustand';
import { toast } from 'sonner';

import type { BranchNode, LiveIllustration, MapViewMode, NarrationBeat, SegmentGeo } from '../types';

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
  /** Narration beats from interleaved TEXT+IMAGE generation */
  beats: NarrationBeat[];
  /** All beats keyed by segmentId (populated during pipeline SSE) */
  beatsMap: Record<string, NarrationBeat[]>;
  /** Index of the beat currently being narrated */
  currentBeatIndex: number;
  /** Whether beat narration is in progress */
  isNarrating: boolean;
  /** Add a new beat (from SSE event) — stores in beatsMap by segmentId */
  addBeat: (beat: NarrationBeat) => void;
  /** Load beats for a specific segment from beatsMap into active beats */
  loadBeatsForSegment: (segmentId: string) => void;
  /** Advance to next beat */
  advanceBeat: () => void;
  /** Reset active beat state (on segment change) */
  resetBeats: () => void;
  /** Set narration active state */
  setIsNarrating: (v: boolean) => void;
  /** Update an existing beat's visual type and/or URLs */
  updateBeatVisual: (segmentId: string, beatIndex: number, updates: Partial<NarrationBeat>) => void;
}

export const usePlayerStore = create<PlayerStore>()((set) => ({
  isOpen: false,
  currentSegmentId: null,
  playbackOffset: 0,
  captionText: '',
  isKenBurnsPaused: false,
  isIdle: false,
  open: (segmentId) => set((state) => {
    // Load pre-generated beats from beatsMap if available
    const segBeats = state.beatsMap[segmentId] ?? [];
    return { isOpen: true, currentSegmentId: segmentId, isIdle: false, beats: segBeats, currentBeatIndex: 0, isNarrating: false };
  }),
  close: () => set({ isOpen: false, currentSegmentId: null, playbackOffset: 0, captionText: '', segmentGeo: {}, pipelineComplete: false, beats: [], currentBeatIndex: 0, isNarrating: false }),
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
  beats: [],
  beatsMap: {},
  currentBeatIndex: 0,
  isNarrating: false,
  addBeat: (beat) =>
    set((state) => {
      // Store in beatsMap keyed by segmentId
      const segId = beat.segmentId;
      const existing = state.beatsMap[segId] ?? [];
      // Avoid duplicates (same beatIndex)
      if (existing.some((b) => b.beatIndex === beat.beatIndex)) {
        return {};
      }
      const updated = [...existing, beat].sort((a, b) => a.beatIndex - b.beatIndex);
      const newMap = { ...state.beatsMap, [segId]: updated };

      // If this beat belongs to the currently active segment, also update active beats
      if (segId === state.currentSegmentId) {
        return { beatsMap: newMap, beats: updated };
      }
      return { beatsMap: newMap };
    }),
  loadBeatsForSegment: (segmentId) =>
    set((state) => {
      const segBeats = state.beatsMap[segmentId] ?? [];
      return { beats: segBeats, currentBeatIndex: 0, isNarrating: false };
    }),
  advanceBeat: () =>
    set((state) => ({
      currentBeatIndex: Math.min(state.currentBeatIndex + 1, state.beats.length - 1),
    })),
  resetBeats: () => set({ beats: [], currentBeatIndex: 0, isNarrating: false }),
  setIsNarrating: (isNarrating) => set({ isNarrating }),
  updateBeatVisual: (segmentId, beatIndex, updates) =>
    set((state) => {
      const segBeats = state.beatsMap[segmentId];
      if (!segBeats) return {};
      const updatedBeats = segBeats.map((b) =>
        b.beatIndex === beatIndex ? { ...b, ...updates } : b,
      );
      const newMap = { ...state.beatsMap, [segmentId]: updatedBeats };
      if (segmentId === state.currentSegmentId) {
        return { beatsMap: newMap, beats: updatedBeats };
      }
      return { beatsMap: newMap };
    }),
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
