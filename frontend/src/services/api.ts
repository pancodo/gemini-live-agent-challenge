import type { CreateSessionResponse, SessionStatusResponse, AgentLogsResponse, Segment } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export async function createSession(filename: string, language?: string): Promise<CreateSessionResponse> {
  const params = new URLSearchParams({ filename });
  if (language) params.set('language', language);
  const res = await fetch(`${BASE_URL}/api/session/create?${params}`);
  if (!res.ok) throw new Error(`Session create failed: ${res.status}`);
  return res.json() as Promise<CreateSessionResponse>;
}

export async function getSessionStatus(sessionId: string): Promise<SessionStatusResponse> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/status`);
  if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`);
  return res.json() as Promise<SessionStatusResponse>;
}

export async function getAgentLogs(sessionId: string, agentId: string): Promise<AgentLogsResponse> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/agent/${agentId}/logs`);
  if (!res.ok) throw new Error(`Agent logs fetch failed: ${res.status}`);
  return res.json() as Promise<AgentLogsResponse>;
}

export async function getSegments(sessionId: string): Promise<Segment[]> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/segments`);
  if (!res.ok) throw new Error(`Segments fetch failed: ${res.status}`);
  const data = await res.json() as { segments: Segment[] };
  return data.segments;
}
