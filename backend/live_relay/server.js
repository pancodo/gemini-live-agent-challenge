'use strict';

// ---------------------------------------------------------------------------
// Live Relay Server
// ---------------------------------------------------------------------------
// Node.js WebSocket proxy that sits between the browser and the Gemini Live
// API. On each new client connection it:
//
//   1. Parses the sessionId from the URL path  (/session/:sessionId)
//   2. Fetches documentary context from Firestore (cached 15 min)
//   3. Builds a system instruction that gives the historian persona full
//      knowledge of the documentary segments, sources, and visual bible
//   4. Opens an upstream WebSocket to Gemini Live API
//   5. Sends `BidiGenerateContentSetup` as the first message
//   6. Relays audio bidirectionally between client and Gemini
//
// Environment variables:
//   GEMINI_API_KEY  - Google AI API key (from Secret Manager in Cloud Run)
//   GEMINI_MODEL    - Model ID (default: gemini-2.5-flash-native-audio-preview-12-2025)
//   GCP_PROJECT_ID  - GCP project for Firestore
//   PORT            - HTTP/WS listen port (default: 8080)
//   HISTORIAN_API_URL - historian-api base URL (default: http://localhost:8000)
// ---------------------------------------------------------------------------

const http = require('node:http');
const { URL } = require('node:url');
const { WebSocket, WebSocketServer } = require('ws');
const {
  fetchDocumentaryContext,
  getFirestore,
  saveResumptionToken,
  loadResumptionToken,
} = require('./firestore-context');
const { buildSystemInstruction } = require('./prompt-builder');
const { PERSONA_PROMPTS } = require('./personas');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '8080', 10);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL =
  process.env.GEMINI_MODEL || 'gemini-2.5-flash-native-audio-preview-12-2025';

const GEMINI_WS_URL =
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent` +
  `?key=${GEMINI_API_KEY}`;

/** Cache TTL in milliseconds (15 minutes). */
const CONTEXT_TTL_MS = 15 * 60 * 1000;

/** Base URL of the historian-api Cloud Run service. */
const HISTORIAN_API_URL = process.env.HISTORIAN_API_URL || 'http://localhost:8000';

// ---------------------------------------------------------------------------
// System instruction cache
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} CacheEntry
 * @property {string} text
 * @property {number} expiresAt
 */

/** @type {Map<string, CacheEntry>} */
const systemInstructionCache = new Map();

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const transcriptDebounceTimers = new Map();

/**
 * @typedef {Object} QueryCacheEntry
 * @property {string} result
 * @property {number} expiresAt
 */
/** @type {Map<string, Map<string, QueryCacheEntry>>} */
const queryResultCache = new Map();

// --- LIVE ILLUSTRATION ---
const ILLUSTRATION_COOLDOWN_MS = 12_000;
/** @type {Map<string, number>} sessionId → last illustration timestamp */
const lastIllustrationTime = new Map();

function _normalizeQuery(query) {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

function _getSessionQueryCache(sessionId) {
  if (!queryResultCache.has(sessionId)) {
    queryResultCache.set(sessionId, new Map());
  }
  return queryResultCache.get(sessionId);
}

/**
 * Get or build the system instruction for a session.
 *
 * Checks the in-memory cache first. On miss (or expiry) it fetches context
 * from Firestore and rebuilds the instruction.
 *
 * @param {string} sessionId
 * @returns {Promise<string>}
 */
async function getSystemInstruction(sessionId) {
  const now = Date.now();
  const cached = systemInstructionCache.get(sessionId);

  if (cached && cached.expiresAt > now) {
    return cached.text;
  }

  const context = await fetchDocumentaryContext(sessionId);

  // Fetch persona preference from the session document
  let persona = 'professor';
  try {
    const db = getFirestore();
    const sessionDoc = await db.collection('sessions').doc(sessionId).get();
    if (sessionDoc.exists) {
      persona = sessionDoc.data()?.persona || 'professor';
    }
  } catch (err) {
    console.warn(`[live-relay] Failed to fetch persona for session=${sessionId}, using default:`, err.message);
  }

  const personaPrompt = PERSONA_PROMPTS[persona] || PERSONA_PROMPTS.professor;
  const documentaryInstruction = buildSystemInstruction(context);
  const text = `${personaPrompt}\n\n${documentaryInstruction}`;

  systemInstructionCache.set(sessionId, {
    text,
    expiresAt: now + CONTEXT_TTL_MS,
  });

  return text;
}

// Periodically prune expired entries to avoid unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of systemInstructionCache) {
    if (entry.expiresAt <= now) {
      systemInstructionCache.delete(key);
    }
  }
  for (const [sid, sessionCache] of queryResultCache) {
    for (const [k, entry] of sessionCache) {
      if (entry.expiresAt <= now) sessionCache.delete(k);
    }
    if (sessionCache.size === 0) queryResultCache.delete(sid);
  }
  // Clean expired illustration cooldowns (older than 5 minutes)
  for (const [sid, ts] of lastIllustrationTime) {
    if (now - ts > 5 * 60 * 1000) lastIllustrationTime.delete(sid);
  }
}, 5 * 60 * 1000); // every 5 minutes

/**
 * Call the historian-api /retrieve endpoint to get semantically relevant
 * document chunks for the given user query.
 *
 * Returns a formatted string ready for injection into Gemini Live, or an
 * empty string on any error (best-effort, never throws).
 *
 * @param {string} sessionId
 * @param {string} query  The user's speech transcript.
 * @returns {Promise<string>}
 */
async function retrieveContext(sessionId, query) {
  const now = Date.now();
  const key = _normalizeQuery(query);
  const cache = _getSessionQueryCache(sessionId);

  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.result;

  try {
    const res = await fetch(
      `${HISTORIAN_API_URL}/api/session/${sessionId}/retrieve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, top_k: 4 }),
        signal: AbortSignal.timeout(1500),
      }
    );
    if (!res.ok) return '';
    const { chunks } = await res.json();
    if (!chunks || chunks.length === 0) return '';

    const contextText = chunks
      .map(c => {
        const pages = c.page_end > c.page_start
          ? `p.${c.page_start}–${c.page_end}`
          : `p.${c.page_start}`;
        const heading = c.heading ? `${c.heading}: ` : '';
        let body = c.summary || '';
        if (!body) {
          const raw = c.text.slice(0, 400);
          const match = raw.match(/(.+[.!?])\s*$/);
          body = match ? match[1] : raw;
        }
        return `[Document ${pages}] ${heading}${body}`;
      })
      .join('\n');

    // Cache for 60 seconds; evict oldest if over 20 entries
    cache.set(key, { result: contextText, expiresAt: now + 60_000 });
    if (cache.size > 20) cache.delete(cache.keys().next().value);

    return contextText;
  } catch {
    return '';
  }
}

/**
 * Fire-and-forget illustration generation. Sends the result to the client
 * WebSocket as a `live_illustration` message. Never throws — errors are
 * silently swallowed because the historian voice must never be interrupted.
 *
 * @param {string} sessionId
 * @param {string} transcript  User's speech transcript
 * @param {WebSocket} clientWs  Browser WebSocket to send result to
 */
async function maybeGenerateIllustration(sessionId, transcript, clientWs) {
  // 1. Cooldown check
  const now = Date.now();
  const lastTime = lastIllustrationTime.get(sessionId) || 0;
  if (now - lastTime < ILLUSTRATION_COOLDOWN_MS) return;

  // 2. Minimum length heuristic
  if (transcript.length < 20) return;

  // 3. Set cooldown immediately (prevents double-fire)
  lastIllustrationTime.set(sessionId, now);

  try {
    const res = await fetch(
      `${HISTORIAN_API_URL}/api/session/${sessionId}/illustrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: transcript,
          current_segment_id: '',
          mood: 'cinematic',
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );

    if (!res.ok) return;
    const { imageUrl, caption } = await res.json();

    if (imageUrl && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({
        type: 'live_illustration',
        imageUrl,
        caption,
      }));
    }
  } catch (err) {
    console.warn('[live-relay] Illustration generation failed:', err.message);
    // Non-fatal: historian voice continues regardless
  }
}

// ---------------------------------------------------------------------------
// HTTP server (health check + WebSocket upgrade)
// ---------------------------------------------------------------------------

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404);
  res.end();
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  // Parse sessionId from path: /session/:sessionId
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const match = url.pathname.match(/^\/session\/([a-zA-Z0-9_-]+)$/);

  if (!match) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }

  const sessionId = match[1];

  wss.handleUpgrade(req, socket, head, (clientWs) => {
    wss.emit('connection', clientWs, req, sessionId, url.searchParams);
  });
});

/**
 * Handle a new client WebSocket connection.
 *
 * @param {WebSocket} clientWs  - Browser WebSocket
 * @param {http.IncomingMessage} _req
 * @param {string} sessionId
 * @param {URLSearchParams} params
 */
wss.on('connection', async (clientWs, _req, sessionId, params) => {
  // Prefer token from query param; fall back to Firestore for page-refresh recovery
  let resumptionToken = params.get('token') || null;
  if (!resumptionToken) {
    try {
      resumptionToken = await loadResumptionToken(sessionId);
      if (resumptionToken) {
        console.log(`[live-relay] Loaded resumption token from Firestore for session=${sessionId}`);
      }
    } catch (err) {
      console.warn(`[live-relay] Failed to load resumption token from Firestore:`, err.message);
    }
  }

  console.log(`[live-relay] New connection for session=${sessionId}`);

  // ── 1. Fetch / build system instruction ───────────────────────
  /** @type {string} */
  let systemText;
  try {
    systemText = await getSystemInstruction(sessionId);
    console.log(
      `[live-relay] System instruction ready (${systemText.length} chars) for session=${sessionId}`
    );
  } catch (err) {
    console.warn(`[live-relay] Failed to fetch context for session=${sessionId}, using fallback:`, err.message);
    // Fallback: use default persona prompt without documentary context
    const fallbackPersona = PERSONA_PROMPTS.professor || '';
    systemText = fallbackPersona || 'You are a knowledgeable historian. Greet the user and offer to discuss any historical topic.';
  }

  // ── 2. Open upstream Gemini WebSocket ─────────────────────────
  /** @type {WebSocket | null} */
  let geminiWs = null;

  try {
    geminiWs = new WebSocket(GEMINI_WS_URL);
  } catch (err) {
    console.error(`[live-relay] Failed to create Gemini WebSocket:`, err);
    clientWs.send(JSON.stringify({ type: 'error', message: 'Failed to connect to Gemini' }));
    clientWs.close(1011, 'upstream connect failed');
    return;
  }

  /** Whether we have received setupComplete from Gemini. */
  let setupComplete = false;

  /** Accumulates incremental input transcription fragments into full sentences. */
  let pendingTranscript = '';

  // ── 3. Gemini WS opened: send BidiGenerateContentSetup ───────
  geminiWs.addEventListener('open', () => {
    console.log(`[live-relay] Gemini WS connected for session=${sessionId}`);

    /** @type {Record<string, unknown>} */
    const setupMessage = {
      setup: {
        model: `models/${GEMINI_MODEL}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Puck',
              },
            },
            languageCode: 'en-US',
          },
        },
        systemInstruction: {
          parts: [{ text: `${systemText}\n\nIMPORTANT: The user will speak in English only. All transcription and responses must be in English. If you detect non-English speech or noise, treat it as background noise and do not respond. RESPOND IN ENGLISH AT ALL TIMES.` }],
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            startOfSpeechSensitivity: 'START_SENSITIVITY_LOW',
            endOfSpeechSensitivity: 'END_SENSITIVITY_LOW',
            prefixPaddingMs: 40,
            silenceDurationMs: 500,
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        contextWindowCompression: {
          slidingWindow: {},
        },
      },
    };

    // If reconnecting with a resumption token, attach it
    if (resumptionToken) {
      setupMessage.setup.sessionResumption = {
        handle: resumptionToken,
      };
    }

    geminiWs.send(JSON.stringify(setupMessage));
  });

  // ── 4. Handle messages FROM Gemini → relay to client ──────────
  geminiWs.addEventListener('message', (event) => {
    /** @type {string} */
    const raw = typeof event.data === 'string' ? event.data : event.data.toString();

    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error('[live-relay] Failed to parse Gemini message:', raw.slice(0, 500));
      return;
    }

    // Log non-audio messages for debugging
    if (!msg.serverContent?.modelTurn?.parts?.some(p => p.inlineData)) {
      console.log('[live-relay] Gemini msg:', JSON.stringify(msg).slice(0, 300));
    }

    // Setup complete acknowledgement
    if (msg.setupComplete) {
      setupComplete = true;
      clientWs.send(JSON.stringify({ type: 'ready' }));
      return;
    }

    // Session resumption token — persist to Firestore + forward to client
    if (msg.sessionResumptionUpdate?.handle) {
      const handle = msg.sessionResumptionUpdate.handle;
      clientWs.send(
        JSON.stringify({
          type: 'resumption_token',
          token: handle,
        })
      );
      saveResumptionToken(sessionId, handle).catch((err) =>
        console.warn(`[live-relay] Failed to persist resumption token:`, err.message),
      );
    }

    // Go away signal
    if (msg.goAway) {
      clientWs.send(JSON.stringify({ type: 'go_away' }));
      return;
    }

    // Server content (audio or interruption)
    if (msg.serverContent) {
      // Interruption
      if (msg.serverContent.interrupted) {
        clientWs.send(JSON.stringify({ type: 'interrupted' }));
        return;
      }

      // Turn complete — historian finished speaking
      if (msg.serverContent.turnComplete) {
        pendingTranscript = '';
        clientWs.send(JSON.stringify({ type: 'turn_complete' }));
      }

      // Audio parts
      const parts = msg.serverContent.modelTurn?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part.inlineData?.data) {
            clientWs.send(
              JSON.stringify({
                type: 'audio',
                data: part.inlineData.data,
              })
            );
          }
        }
      }

      // Output transcript (historian's own speech -> text captions)
      if (msg.serverContent?.outputTranscription?.text) {
        clientWs.send(
          JSON.stringify({
            type: 'caption',
            text: msg.serverContent.outputTranscription.text,
          })
        );
      }

      // Input transcript (user speech -> text)
      // Gemini sends incremental fragments; accumulate into a running sentence.
      if (msg.serverContent?.inputTranscription?.text) {
        const fragment = msg.serverContent.inputTranscription.text;

        // Skip noise markers
        if (fragment.trim() === '<noise>' || fragment.trim().length < 1) {
          return;
        }

        pendingTranscript += fragment;
        const transcript = pendingTranscript.trim();

        if (!transcript || transcript.length < 2) return;

        // Forward accumulated transcript to the frontend.
        clientWs.send(JSON.stringify({ type: 'transcript', text: transcript }));

        // RAG injection: for substantive questions (>15 chars), retrieve relevant
        // document passages and inject them upstream before the historian responds.
        if (transcript.length > 15 && geminiWs.readyState === WebSocket.OPEN) {
          // Debounce: Gemini Live streams partial transcripts; only fire on the final one
          const existing = transcriptDebounceTimers.get(sessionId);
          if (existing) clearTimeout(existing);
          const timer = setTimeout(() => {
            transcriptDebounceTimers.delete(sessionId);
            retrieveContext(sessionId, transcript).then(contextText => {
              if (!contextText || geminiWs.readyState !== WebSocket.OPEN) return;
              geminiWs.send(JSON.stringify({
                clientContent: {
                  turns: [{
                    role: 'user',
                    parts: [{ text: `[System: Retrieved document context]\n${contextText}` }],
                  }],
                  turnComplete: false,
                },
              }));
            }).catch(() => {});
          }, 300);
          transcriptDebounceTimers.set(sessionId, timer);
        }

        // Fire-and-forget live illustration
        maybeGenerateIllustration(sessionId, transcript, clientWs);
      }
    }
  });

  // ── 5. Handle messages FROM client → relay to Gemini ──────────
  clientWs.addEventListener('message', (event) => {
    if (!geminiWs || geminiWs.readyState !== WebSocket.OPEN || !setupComplete) {
      return;
    }

    let msg;
    try {
      msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
    } catch {
      return;
    }

    if (msg.type === 'audio' && msg.data) {
      // Forward PCM audio to Gemini as realtimeInput
      geminiWs.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [
              {
                mimeType: 'audio/pcm;rate=16000',
                data: msg.data,
              },
            ],
          },
        })
      );
    } else if (msg.type === 'text' && msg.text) {
      // Forward text message to Gemini as clientContent
      geminiWs.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [{ text: msg.text }],
              },
            ],
            turnComplete: true,
          },
        })
      );
    }
  });

  // ── 6. Cleanup on disconnect ──────────────────────────────────

  /** Close upstream when client disconnects. */
  clientWs.addEventListener('close', (event) => {
    console.log(
      `[live-relay] Client disconnected session=${sessionId} code=${event.code}`
    );
    if (geminiWs && geminiWs.readyState === WebSocket.OPEN) {
      geminiWs.close(1000, 'client disconnected');
    }
    const pendingTimer = transcriptDebounceTimers.get(sessionId);
    if (pendingTimer) { clearTimeout(pendingTimer); transcriptDebounceTimers.delete(sessionId); }
    lastIllustrationTime.delete(sessionId);
  });

  /** Close client when Gemini disconnects unexpectedly. */
  geminiWs.addEventListener('close', (event) => {
    console.log(
      `[live-relay] Gemini WS closed session=${sessionId} code=${event.code} reason=${event.reason}`
    );
    if (clientWs.readyState === WebSocket.OPEN) {
      // Don't send error for normal closure
      if (event.code !== 1000) {
        clientWs.send(
          JSON.stringify({ type: 'error', message: `Gemini connection closed (${event.code})` })
        );
      }
    }
  });

  geminiWs.addEventListener('error', (err) => {
    console.error(`[live-relay] Gemini WS error session=${sessionId}:`, err.message || err);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', message: 'Upstream connection error' }));
    }
  });

  clientWs.addEventListener('error', (err) => {
    console.error(`[live-relay] Client WS error session=${sessionId}:`, err.message || err);
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

httpServer.listen(PORT, () => {
  console.log(`[live-relay] Listening on port ${PORT}`);
  console.log(`[live-relay] Model: ${GEMINI_MODEL}`);
  console.log(`[live-relay] API key configured: ${GEMINI_API_KEY ? 'yes' : 'NO'}`);
});
