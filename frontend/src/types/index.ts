// ============================================================
// AI Historian — Shared Type Contract
// All components, hooks, and stores import from this file.
// ============================================================

// ── Persona ─────────────────────────────────────────────────
export type PersonaType = 'professor' | 'storyteller' | 'explorer';

// ── Research Mode ───────────────────────────────────────────
export type ResearchMode = 'test' | 'normal';

// ── Session ──────────────────────────────────────────────────
export type SessionStatus = 'idle' | 'uploading' | 'processing' | 'ready' | 'playing' | 'error';

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

export interface EvaluatedSource {
  url: string;
  accepted: boolean;
  reason: string;
  title?: string;
  imageUrl?: string;
  description?: string;
  favicon?: string;
  relevanceScore?: number;  // 0–100; derived client-side if absent
}

export interface UrlMeta {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  favicon: string | null;
  hostname: string;
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
  evaluatedSources?: EvaluatedSource[];
  currentActivity?: string;
  visualResearchPrompt?: string;
  errorMessage?: string;
}

// ── Beat Visual Types ─────────────────────────────────────────
export type BeatVisualType = 'illustration' | 'cinematic' | 'video';

// ── Segments ─────────────────────────────────────────────────
export type SegmentStatus = 'generating' | 'ready' | 'visual_ready' | 'complete' | 'pending' | 'storyboard_ready' | 'beats_ready';

export type PortraitEra = 'default' | 'ancient' | 'modern';

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
  era?: PortraitEra;
}

// ── Voice ────────────────────────────────────────────────────
export type VoiceState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'historian_speaking'
  | 'interrupted'
  | 'reconnecting';

// ── SSE Events ───────────────────────────────────────────────
export type SSEEventType =
  | 'agent_status'
  | 'agent_source_evaluation'
  | 'segment_update'
  | 'pipeline_phase'
  | 'stats_update'
  | 'live_illustration'
  | 'geo_update'
  | 'storyboard_scene_start'
  | 'storyboard_text_chunk'
  | 'storyboard_image_ready'
  | 'segment_playable'
  | 'narration_beat'
  | 'beat_visual_assigned'
  | 'session_label'
  | 'error';

export interface AgentStatusEvent {
  type: 'agent_status';
  agentId: string;
  status: AgentStatus;
  query?: string;
  facts?: string[];
  elapsed?: number;
  errorMessage?: string;
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
  phase: number;
  label: string;
  message: string;
}

export interface StatsUpdateEvent {
  type: 'stats_update';
  sourcesFound?: number;
  factsVerified?: number;
  segmentsReady?: number;
}

export interface AgentSourceEvaluationEvent {
  type: 'agent_source_evaluation';
  agentId: string;
  source: EvaluatedSource;
}

export interface SessionLabelEvent {
  type: 'session_label';
  label: string;
}

export interface ErrorEvent {
  type: 'error';
  message: string;
  agentId?: string;
}

export interface LiveIllustration {
  imageUrl: string;
  caption: string;
  receivedAt: number;
  query?: string;
}

export interface LiveIllustrationEvent {
  type: 'live_illustration';
  segmentId: string;
  imageUrl: string;
  caption: string;
  query: string;
}

export interface GeoUpdateEvent {
  type: 'geo_update';
  segmentId: string;
  geo: SegmentGeo;
}

export interface StoryboardSceneStartEvent {
  type: 'storyboard_scene_start';
  sceneId: string;
  segmentId: string;
  title: string;
  mood: string;
}

export interface StoryboardTextChunkEvent {
  type: 'storyboard_text_chunk';
  sceneId: string;
  text: string;
}

export interface StoryboardImageReadyEvent {
  type: 'storyboard_image_ready';
  sceneId: string;
  segmentId: string;
  imageUrl: string;
  caption: string;
}

export interface SegmentPlayableEvent {
  type: 'segment_playable';
  segmentId: string;
}

export interface BeatVisualAssignedEvent {
  type: 'beat_visual_assigned';
  segmentId: string;
  beatIndex: number;
  visualType: BeatVisualType;
}

export interface NarrationBeatEvent {
  type: 'narration_beat';
  segmentId: string;
  beatIndex: number;
  totalBeats: number;
  narrationText: string;
  imageUrl: string | null;
  directionText: string;
  visualType?: BeatVisualType;
  cinematicUrl?: string | null;
  videoUrl?: string | null;
}

export interface NarrationBeat {
  segmentId: string;
  beatIndex: number;
  totalBeats: number;
  narrationText: string;
  imageUrl: string | null;
  directionText: string;
  visualType?: BeatVisualType;
  cinematicUrl?: string | null;
  videoUrl?: string | null;
}

export type SSEEvent =
  | AgentStatusEvent
  | AgentSourceEvaluationEvent
  | SegmentUpdateEvent
  | PipelinePhaseEvent
  | StatsUpdateEvent
  | LiveIllustrationEvent
  | GeoUpdateEvent
  | StoryboardSceneStartEvent
  | StoryboardTextChunkEvent
  | StoryboardImageReadyEvent
  | SegmentPlayableEvent
  | NarrationBeatEvent
  | BeatVisualAssignedEvent
  | SessionLabelEvent
  | ErrorEvent;

// ── Documentary Branching ─────────────────────────────────────
export interface BranchNode {
  segmentId: string;
  parentSegmentId: string | null;
  triggerQuestion: string;
  depth: number;
  createdAt: string;
}

// ── PDF Entity Highlights ─────────────────────────────────────
export interface EntityHighlight {
  text: string;
  segmentId: string;
  pageNumber: number;
  charOffset: number;
}

// ── Grounding Evidence ────────────────────────────────────────
export interface GroundingSource {
  url: string;
  title: string;
  relevanceScore: number; // 0–1
  acceptedBy: string[];   // agentIds that accepted this source
}

// ── Shareable Clips ───────────────────────────────────────────
export interface ClipStatus {
  clipId: string;
  status: 'queued' | 'generating' | 'ready' | 'error';
  downloadUrl?: string;
  segmentId: string;
}

// ── Geographic / Timeline Map ─────────────────────────────────
export interface GeoEvent {
  name: string;
  lat: number;
  lng: number;
  type: 'city' | 'battle' | 'route' | 'region';
  era?: string;
  description?: string;
}

export interface GeoRoute {
  name: string;
  points: [number, number][];
  style: 'trade' | 'military' | 'migration';
}

export interface SegmentGeo {
  segmentId: string;
  center: [number, number];
  zoom: number;
  events: GeoEvent[];
  routes: GeoRoute[];
}

export type MapViewMode = 'ken-burns' | 'map' | 'split';

// ── Session History ──────────────────────────────────────────
export interface SessionListItem {
  sessionId: string;
  status: SessionStatus;
  label: string;
  language: string | null;
  persona: string | null;
  createdAt: string | null;
}

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
