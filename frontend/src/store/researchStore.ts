import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';
import type { AgentState, EntityHighlight, EvaluatedSource, Segment } from '../types';

const MAX_EVALUATED_SOURCES = 50;

export interface PhaseEntry {
  phase: 1 | 2 | 3 | 4 | 5;
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
  setAgent: (agentId: string, state: Partial<AgentState>) => void;
  setSegment: (segmentId: string, state: Partial<Segment>) => void;
  appendSegmentImage: (segmentId: string, imageUrl: string) => void;
  updateStats: (stats: Partial<ResearchStore['stats']>) => void;
  addPhaseMessage: (phase: 1 | 2 | 3 | 4 | 5, label: string, message: string) => void;
  addEvaluatedSource: (agentId: string, source: EvaluatedSource) => void;
  setScanEntities: (entities: string[]) => void;
  setEntityHighlights: (segmentId: string, highlights: EntityHighlight[]) => void;
  reset: () => void;
}

export const useResearchStore = create<ResearchStore>()(persist(subscribeWithSelector((set) => ({
  agents: {},
  segments: {},
  stats: { sourcesFound: 0, factsVerified: 0, segmentsReady: 0 },
  phases: [],
  scanEntities: [],
  entityHighlights: {},
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
  reset: () =>
    set({
      agents: {},
      segments: {},
      stats: { sourcesFound: 0, factsVerified: 0, segmentsReady: 0 },
      phases: [],
      scanEntities: [],
      entityHighlights: {},
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
  }) as unknown as ResearchStore,
}));
