import type { CreateSessionResponse, SessionStatusResponse, AgentLogsResponse, Segment, UrlMeta, SegmentGeo } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

export async function createSession(filename: string, language?: string, persona?: string): Promise<CreateSessionResponse> {
  const params = new URLSearchParams({ filename });
  if (language) params.set('language', language);
  if (persona) params.set('persona', persona);
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

export async function getUrlMeta(url: string): Promise<UrlMeta> {
  const res = await fetch(`${BASE_URL}/api/meta?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`Meta fetch failed: ${res.status}`);
  return res.json() as Promise<UrlMeta>;
}

const GEMINI_FLASH_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Extract geographic locations and routes from a segment script using Gemini Flash.
 * Runs client-side to avoid modifying the backend agent pipeline.
 */
export async function extractGeoData(segmentId: string, script: string, title: string): Promise<SegmentGeo> {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('VITE_GEMINI_API_KEY not set — cannot extract geographic data');
  }

  const prompt = `You are a historical geography expert. Extract all geographic locations, routes, and events from this documentary segment script.

Title: ${title}
Script: ${script}

Return a JSON object with this exact structure (no markdown, no code fences, just raw JSON):
{
  "center": [lat, lng],
  "zoom": <number 2-8>,
  "events": [
    {
      "name": "<place name>",
      "lat": <number>,
      "lng": <number>,
      "type": "city" | "battle" | "route" | "region",
      "era": "<year or period>",
      "description": "<one sentence>"
    }
  ],
  "routes": [
    {
      "name": "<route name>",
      "points": [[lat, lng], [lat, lng], ...],
      "style": "trade" | "military" | "migration"
    }
  ]
}

Rules:
- Use accurate historical coordinates
- Center should be the geographic midpoint of all mentioned locations
- Zoom should frame all locations (2=world, 5=region, 8=city)
- If no routes are mentioned, return an empty routes array
- Include at least the primary location even if the script is vague`;

  const res = await fetch(`${GEMINI_FLASH_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini geo extraction failed: ${res.status}`);
  }

  const data = await res.json() as {
    candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  };
  const text = data.candidates[0]?.content?.parts[0]?.text ?? '{}';
  const parsed = JSON.parse(text) as Omit<SegmentGeo, 'segmentId'>;

  return {
    segmentId,
    center: parsed.center ?? [30, 30],
    zoom: parsed.zoom ?? 4,
    events: parsed.events ?? [],
    routes: parsed.routes ?? [],
  };
}
