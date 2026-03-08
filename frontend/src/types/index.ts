// ============================================================
// AI Historian — Shared Type Contract
// All components, hooks, and stores import from this file.
// ============================================================

// ── Session ──────────────────────────────────────────────────
export type SessionStatus = 'idle' | 'uploading' | 'processing' | 'ready' | 'playing';

export interface Session {
  sessionId: string;
  gcsPath: string | null;
  status: SessionStatus;
  language: string | null;
  visualBible: string | null;
  createdAt?: string;
}

// ── Agent / Research ─────────────────────────────────────────
export type AgentStatus = 'queued' | 'searching' | 'evaluating' | 'done' | 'error';

export interface AgentLog {
  step: string;
  ts: string;
  data?: string;
}

export interface AgentState {
  id: string;
  query: string;
  status: AgentStatus;
  logs: AgentLog[];
  elapsed: number;
  facts?: string[];
  visualPrompt?: string;
  sourcesFound?: number;
}

// ── Segments ─────────────────────────────────────────────────
export type SegmentStatus = 'generating' | 'ready';

export interface Segment {
  id: string;
  title: string;
  status: SegmentStatus;
  imageUrls: string[];
  videoUrl?: string;
  script: string;
  mood: string;
  sources: string[];
  graphEdges: string[];
}

// ── Voice ────────────────────────────────────────────────────
export type VoiceState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'historian_speaking'
  | 'interrupted';

// ── SSE Events ───────────────────────────────────────────────
export type SSEEventType =
  | 'agent_status'
  | 'segment_update'
  | 'pipeline_phase'
  | 'stats_update'
  | 'error';

export interface AgentStatusEvent {
  type: 'agent_status';
  agentId: string;
  status: AgentStatus;
  query?: string;
  facts?: string[];
  elapsed?: number;
}

export interface SegmentUpdateEvent {
  type: 'segment_update';
  segmentId: string;
  status: SegmentStatus;
  title?: string;
  imageUrls?: string[];
  videoUrl?: string;
  script?: string;
  mood?: string;
}

export interface PipelinePhaseEvent {
  type: 'pipeline_phase';
  phase: 1 | 2 | 3 | 4;
  label: string;
  message: string;
}

export interface StatsUpdateEvent {
  type: 'stats_update';
  sourcesFound: number;
  factsVerified: number;
  segmentsReady: number;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  agentId?: string;
}

export type SSEEvent =
  | AgentStatusEvent
  | SegmentUpdateEvent
  | PipelinePhaseEvent
  | StatsUpdateEvent
  | ErrorEvent;

// ── API Responses ─────────────────────────────────────────────
export interface CreateSessionResponse {
  sessionId: string;
  uploadUrl: string;
  gcsPath: string;
}

export interface SessionStatusResponse {
  sessionId: string;
  status: SessionStatus;
  language: string | null;
  visualBible: string | null;
  documentUrl?: string | null;
}

export interface AgentLogsResponse {
  agentId: string;
  query: string;
  status: AgentStatus;
  logs: AgentLog[];
  facts: string[];
}
