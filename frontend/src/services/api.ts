import type { CreateSessionResponse, SessionStatusResponse, AgentLogsResponse, Segment, UrlMeta, SegmentGeo, GeoEvent, GeoRoute } from '../types';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';

function getAccessHeaders(): Record<string, string> {
  const code = localStorage.getItem('ai-historian-access');
  return code ? { 'X-Access-Code': code } : {};
}

export async function createSession(filename: string, language?: string, persona?: string, mode?: string): Promise<CreateSessionResponse> {
  const params = new URLSearchParams({ filename });
  if (language) params.set('language', language);
  if (persona) params.set('persona', persona);
  if (mode) params.set('mode', mode);
  const res = await fetch(`${BASE_URL}/api/session/create?${params}`, { headers: getAccessHeaders() });
  if (!res.ok) throw new Error(`Session create failed: ${res.status}`);
  return res.json() as Promise<CreateSessionResponse>;
}

export async function getSessionStatus(sessionId: string, signal?: AbortSignal): Promise<SessionStatusResponse> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/status`, { signal, headers: getAccessHeaders() });
  if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`);
  return res.json() as Promise<SessionStatusResponse>;
}

export async function getAgentLogs(sessionId: string, agentId: string, signal?: AbortSignal): Promise<AgentLogsResponse> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/agent/${agentId}/logs`, { signal, headers: getAccessHeaders() });
  if (!res.ok) throw new Error(`Agent logs fetch failed: ${res.status}`);
  return res.json() as Promise<AgentLogsResponse>;
}

export async function getSegments(sessionId: string, signal?: AbortSignal): Promise<Segment[]> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/segments`, { signal, headers: getAccessHeaders() });
  if (!res.ok) throw new Error(`Segments fetch failed: ${res.status}`);
  const data = await res.json() as { segments: Segment[] };
  return data.segments;
}

export async function getUrlMeta(url: string, signal?: AbortSignal): Promise<UrlMeta> {
  const res = await fetch(`${BASE_URL}/api/meta?url=${encodeURIComponent(url)}`, { signal, headers: getAccessHeaders() });
  if (!res.ok) throw new Error(`Meta fetch failed: ${res.status}`);
  return res.json() as Promise<UrlMeta>;
}

const GEMINI_FLASH_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Extract geographic locations and routes from a segment script using Gemini Flash.
 * Runs client-side to avoid modifying the backend agent pipeline.
 */
export async function extractGeoData(segmentId: string, script: string, title: string, signal?: AbortSignal): Promise<SegmentGeo> {
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
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
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
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  if (!data.candidates?.length) {
    throw new Error('Gemini returned no candidates — content may have been filtered');
  }

  const text = data.candidates[0]?.content?.parts?.[0]?.text ?? '{}';

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    console.warn('[extractGeoData] JSON parse failed, returning fallback');
    return { segmentId, center: [30, 30] as [number, number], zoom: 4, events: [], routes: [] };
  }

  // Validate center tuple
  const rawCenter = Array.isArray(raw.center) && raw.center.length >= 2
    && typeof raw.center[0] === 'number' && typeof raw.center[1] === 'number'
    ? [raw.center[0], raw.center[1]] as [number, number]
    : [30, 30] as [number, number];

  // Validate & filter events — discard entries with missing/invalid coordinates
  const events: GeoEvent[] = (Array.isArray(raw.events) ? raw.events : [])
    .filter((e): e is GeoEvent =>
      typeof e === 'object' && e !== null &&
      typeof e.name === 'string' &&
      typeof e.lat === 'number' && !isNaN(e.lat) &&
      typeof e.lng === 'number' && !isNaN(e.lng),
    )
    .map((e) => {
      // Fix swapped coordinates and clamp to valid range
      let { lat, lng } = e;
      if (Math.abs(lat) > 90) [lat, lng] = [lng, lat];
      lat = Math.max(-90, Math.min(90, lat));
      lng = Math.max(-180, Math.min(180, lng));
      return { ...e, lat, lng };
    });

  // Validate & filter routes
  const routes: GeoRoute[] = (Array.isArray(raw.routes) ? raw.routes : [])
    .filter((r): r is GeoRoute =>
      typeof r === 'object' && r !== null &&
      typeof r.name === 'string' &&
      Array.isArray(r.points) && r.points.length >= 2 &&
      r.points.every((p: unknown) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'),
    );

  const result: SegmentGeo = {
    segmentId,
    center: rawCenter,
    zoom: typeof raw.zoom === 'number' && !isNaN(raw.zoom) ? raw.zoom : 4,
    events,
    routes,
  };

  // Don't cache empty results — allow retry on next render
  if (result.events.length === 0 && result.routes.length === 0) {
    throw new Error('Geo extraction returned no events or routes');
  }

  return result;
}

export async function startNarration(sessionId: string, segmentId: string, signal?: AbortSignal): Promise<{ beatsGenerated: number; segmentId: string }> {
  const res = await fetch(`${BASE_URL}/api/session/${sessionId}/segment/${segmentId}/narrate`, {
    method: 'POST',
    headers: getAccessHeaders(),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(60_000)])
      : AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    if (res.status === 429) return { beatsGenerated: 0, segmentId };
    throw new Error(`Narration failed: ${res.status}`);
  }
  return res.json() as Promise<{ beatsGenerated: number; segmentId: string }>;
}
