import { create } from 'zustand';
import type { AgentState, EvaluatedSource, Segment } from '../types';

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
  /** Entity terms extracted by the scan_agent — used for PDF text layer highlighting */
  scanEntities: string[];
  setAgent: (agentId: string, state: Partial<AgentState>) => void;
  setSegment: (segmentId: string, state: Partial<Segment>) => void;
  updateStats: (stats: Partial<ResearchStore['stats']>) => void;
  addPhaseMessage: (phase: 1 | 2 | 3 | 4 | 5, label: string, message: string) => void;
  addEvaluatedSource: (agentId: string, source: EvaluatedSource) => void;
  setScanEntities: (entities: string[]) => void;
  reset: () => void;
}

export const useResearchStore = create<ResearchStore>()((set) => ({
  agents: {},
  segments: {},
  stats: { sourcesFound: 0, factsVerified: 0, segmentsReady: 0 },
  phases: [],
  scanEntities: [],
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
      return {
        agents: {
          ...s.agents,
          [agentId]: {
            ...agent,
            evaluatedSources: [...(agent.evaluatedSources ?? []), source],
          },
        },
      };
    }),
  setScanEntities: (entities) => set({ scanEntities: entities }),
  reset: () =>
    set({
      agents: {},
      segments: {},
      stats: { sourcesFound: 0, factsVerified: 0, segmentsReady: 0 },
      phases: [],
      scanEntities: [],
    }),
}));
