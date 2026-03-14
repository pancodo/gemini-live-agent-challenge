import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';
import type { AgentState, EntityHighlight, EvaluatedSource, Segment } from '../types';

const MAX_EVALUATED_SOURCES = 50;

export interface StoryboardFrame {
  sceneId: string;
  segmentId: string;
  title: string;
  mood: string;
  textChunks: string[];
  imageUrl: string | null;
  imageCaption: string;
  completedAt: number | null;
}

export interface PhaseEntry {
  phase: number;
  label: string;
  messages: string[];
  startedAt: number;
}

interface ResearchStore {
  agents: Record<string, AgentState>;
  segments: Record<string, Segment>;
  stats: { sourcesFound: number; factsVerified: number; segmentsReady: number };
  phases: PhaseEntry[];
  /** Entity terms extracted by the scan_agent -- used for PDF text layer highlighting */
  scanEntities: string[];
  /** Per-segment entity highlights mapping narration entities to PDF page locations */
  entityHighlights: Record<string, EntityHighlight[]>;
  /** Storyboard frames keyed by sceneId, populated by streaming storyboard events */
  storyboardFrames: Record<string, StoryboardFrame>;
  setAgent: (agentId: string, state: Partial<AgentState>) => void;
  setSegment: (segmentId: string, state: Partial<Segment>) => void;
  appendSegmentImage: (segmentId: string, imageUrl: string) => void;
  updateStats: (stats: Partial<ResearchStore['stats']>) => void;
  addPhaseMessage: (phase: number, label: string, message: string) => void;
  addEvaluatedSource: (agentId: string, source: EvaluatedSource) => void;
  setScanEntities: (entities: string[]) => void;
  setEntityHighlights: (segmentId: string, highlights: EntityHighlight[]) => void;
  addStoryboardScene: (sceneId: string, segmentId: string, title: string, mood: string) => void;
  appendStoryboardText: (sceneId: string, text: string) => void;
  setStoryboardImage: (sceneId: string, imageUrl: string, caption: string) => void;
  reset: () => void;
}

export const useResearchStore = create<ResearchStore>()(persist(subscribeWithSelector((set) => ({
  agents: {},
  segments: {},
  stats: { sourcesFound: 0, factsVerified: 0, segmentsReady: 0 },
  phases: [],
  scanEntities: [],
  entityHighlights: {},
  storyboardFrames: {},
  setAgent: (agentId, partial) =>
    set((s) => ({
      agents: {
        ...s.agents,
        [agentId]: { ...s.agents[agentId], ...partial },
      },
    })),
  setSegment: (segmentId, partial) =>
    set((s) => ({
      segments: {
        ...s.segments,
        [segmentId]: { ...{ id: segmentId, title: '', status: 'generating' as const, imageUrls: [], script: '', mood: '', sources: [], graphEdges: [] }, ...s.segments[segmentId], ...partial },
      },
    })),
  appendSegmentImage: (segmentId, imageUrl) =>
    set((s) => {
      const seg = s.segments[segmentId];
      if (!seg) return s;
      return {
        segments: {
          ...s.segments,
          [segmentId]: {
            ...seg,
            imageUrls: [...seg.imageUrls, imageUrl],
          },
        },
      };
    }),
  updateStats: (partial) =>
    set((s) => ({ stats: { ...s.stats, ...partial } })),
  addPhaseMessage: (phase, label, message) =>
    set((s) => {
      const existing = s.phases.find((p) => p.phase === phase);
      if (existing) {
        return {
          phases: s.phases.map((p) =>
            p.phase === phase
              ? { ...p, messages: [...p.messages, message] }
              : p,
          ),
        };
      }
      return {
        phases: [
          ...s.phases,
          { phase, label, messages: [message], startedAt: Date.now() },
        ],
      };
    }),
  addEvaluatedSource: (agentId, source) =>
    set((s) => {
      const agent = s.agents[agentId];
      if (!agent) return s;
      let sources = [...(agent.evaluatedSources ?? []), source];
      if (sources.length > MAX_EVALUATED_SOURCES) {
        sources = sources.slice(-MAX_EVALUATED_SOURCES);
      }
      return {
        agents: {
          ...s.agents,
          [agentId]: {
            ...agent,
            evaluatedSources: sources,
          },
        },
      };
    }),
  setScanEntities: (entities) => set({ scanEntities: entities }),
  setEntityHighlights: (segmentId, highlights) =>
    set((s) => ({
      entityHighlights: {
        ...s.entityHighlights,
        [segmentId]: highlights,
      },
    })),
  addStoryboardScene: (sceneId, segmentId, title, mood) =>
    set((s) => ({
      storyboardFrames: {
        ...s.storyboardFrames,
        [sceneId]: {
          sceneId,
          segmentId,
          title,
          mood,
          textChunks: [],
          imageUrl: null,
          imageCaption: '',
          completedAt: null,
        },
      },
    })),
  appendStoryboardText: (sceneId, text) =>
    set((s) => {
      const frame = s.storyboardFrames[sceneId];
      if (!frame) return s;
      return {
        storyboardFrames: {
          ...s.storyboardFrames,
          [sceneId]: {
            ...frame,
            textChunks: [...frame.textChunks, text],
          },
        },
      };
    }),
  setStoryboardImage: (sceneId, imageUrl, caption) =>
    set((s) => {
      const frame = s.storyboardFrames[sceneId];
      if (!frame) return s;
      return {
        storyboardFrames: {
          ...s.storyboardFrames,
          [sceneId]: {
            ...frame,
            imageUrl,
            imageCaption: caption,
            completedAt: Date.now(),
          },
        },
      };
    }),
  reset: () =>
    set({
      agents: {},
      segments: {},
      stats: { sourcesFound: 0, factsVerified: 0, segmentsReady: 0 },
      phases: [],
      scanEntities: [],
      entityHighlights: {},
      storyboardFrames: {},
    }),
})), {
  name: 'ai-historian-research',
  storage: {
    getItem: (name) => {
      const str = sessionStorage.getItem(name);
      return str ? JSON.parse(str) : null;
    },
    setItem: (name, value) => sessionStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => sessionStorage.removeItem(name),
  },
  partialize: (state) => ({
    agents: state.agents,
    segments: state.segments,
    stats: state.stats,
    phases: state.phases,
    scanEntities: state.scanEntities,
    storyboardFrames: state.storyboardFrames,
  }) as unknown as ResearchStore,
}));
