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
// ---------------------------------------------------------------------------

const http = require('node:http');
const { URL } = require('node:url');
const { WebSocket, WebSocketServer } = require('ws');
const { fetchDocumentaryContext } = require('./firestore-context');
const { buildSystemInstruction } = require('./prompt-builder');

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
  const text = buildSystemInstruction(context);

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
}, 5 * 60 * 1000); // every 5 minutes

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
  const resumptionToken = params.get('token') || null;

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
    console.error(`[live-relay] Failed to fetch context for session=${sessionId}:`, err);
    clientWs.send(JSON.stringify({ type: 'error', message: 'Failed to load documentary context' }));
    clientWs.close(1011, 'context fetch failed');
    return;
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
          },
        },
        systemInstruction: {
          parts: [{ text: systemText }],
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
          },
        },
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
      console.error('[live-relay] Failed to parse Gemini message');
      return;
    }

    // Setup complete acknowledgement
    if (msg.setupComplete) {
      setupComplete = true;
      clientWs.send(JSON.stringify({ type: 'ready' }));
      return;
    }

    // Session resumption token
    if (msg.sessionResumptionUpdate?.handle) {
      clientWs.send(
        JSON.stringify({
          type: 'resumption_token',
          token: msg.sessionResumptionUpdate.handle,
        })
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
  });

  /** Close client when Gemini disconnects unexpectedly. */
  geminiWs.addEventListener('close', (event) => {
    console.log(
      `[live-relay] Gemini WS closed session=${sessionId} code=${event.code}`
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
