import { create } from 'zustand';
import type { AgentState, Segment } from '../types';

interface ResearchStore {
  agents: Record<string, AgentState>;
  segments: Record<string, Segment>;
  stats: { sourcesFound: number; factsVerified: number; segmentsReady: number };
  setAgent: (agentId: string, state: Partial<AgentState>) => void;
  setSegment: (segmentId: string, state: Partial<Segment>) => void;
  updateStats: (stats: Partial<ResearchStore['stats']>) => void;
  reset: () => void;
}

export const useResearchStore = create<ResearchStore>()((set) => ({
  agents: {},
  segments: {},
  stats: { sourcesFound: 0, factsVerified: 0, segmentsReady: 0 },
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
        [segmentId]: { ...s.segments[segmentId], ...partial },
      },
    })),
  updateStats: (partial) =>
    set((s) => ({ stats: { ...s.stats, ...partial } })),
  reset: () => set({ agents: {}, segments: {}, stats: { sourcesFound: 0, factsVerified: 0, segmentsReady: 0 } }),
}));
