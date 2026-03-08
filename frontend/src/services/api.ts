const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export async function createSession(filename: string, language?: string) {
  const params = new URLSearchParams({ filename });
  if (language) params.set('language', language);
  const res = await fetch(`${BASE_URL}/api/session/create?${params}`);
  if (!res.ok) throw new Error(`Session create failed: ${res.status}`);
  return res.json();
}

export async function getSessionStatus(sessionId: string) {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/status`);
  if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`);
  return res.json();
}

export async function getAgentLogs(sessionId: string, agentId: string) {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/agent/${agentId}/logs`);
  if (!res.ok) throw new Error(`Agent logs fetch failed: ${res.status}`);
  return res.json();
}
