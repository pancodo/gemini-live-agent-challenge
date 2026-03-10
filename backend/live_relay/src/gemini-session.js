/**
 * Manages a WebSocket connection to the Gemini Live API.
 *
 * Supports two authentication paths:
 *   1. **Vertex AI** (default) — uses service account bearer token via
 *      Application Default Credentials (ADC). Endpoint:
 *      wss://{region}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent
 *   2. **AI Studio** (fallback) — uses GEMINI_API_KEY query param. Endpoint:
 *      wss://generativelanguage.googleapis.com/ws/...?key=API_KEY
 *
 * Set GEMINI_API_KEY to use AI Studio path. Otherwise, Vertex AI with ADC.
 *
 * @module gemini-session
 */

import WebSocket from 'ws';
import { GoogleAuth } from 'google-auth-library';
import { createLogger } from './logger.js';

const log = createLogger('gemini-session');

// Vertex AI path (default — uses service account / ADC)
const VERTEX_MODEL = 'gemini-live-2.5-flash-native-audio';
const VERTEX_WS_TEMPLATE =
  'wss://{REGION}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent';

// AI Studio path (fallback — uses API key)
const AISTUDIO_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';
const AISTUDIO_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** Resolve which auth path to use. Vertex AI is preferred. */
function resolveAuthConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    return { mode: 'aistudio', apiKey, model: AISTUDIO_MODEL };
  }
  const project = process.env.GCP_PROJECT_ID;
  const region = process.env.VERTEX_AI_LOCATION || 'us-central1';
  return { mode: 'vertex', project, region, model: VERTEX_MODEL };
}

/**
 * Get a fresh OAuth2 access token via Application Default Credentials.
 * Works with GOOGLE_APPLICATION_CREDENTIALS or Cloud Run metadata server.
 */
async function getAccessToken() {
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  return tokenResponse.token;
}

/**
 * A single session with the Gemini Live API over WebSocket.
 *
 * Events are delivered via callback properties that consumers set after
 * construction:
 *
 * - `onReady()`            — Gemini acknowledged the setup message
 * - `onAudio(base64data)`  — an audio chunk from the model's response
 * - `onInterrupted()`      — Gemini detected the user interrupted the model
 * - `onResumptionToken(t)` — a fresh session-resumption handle
 * - `onGoAway()`           — Gemini is about to close the session
 * - `onClose(code, reason)`— WebSocket closed
 * - `onError(error)`       — WebSocket or parse error
 */
class GeminiSession {
  /**
   * @param {Object}  options
   * @param {string}  options.systemInstruction — persona prompt text
   * @param {string}  [options.resumptionToken] — optional handle for session resumption
   */
  constructor({ systemInstruction, resumptionToken }) {
    if (!systemInstruction) throw new Error('systemInstruction is required');

    /** @type {{ mode: string, apiKey?: string, project?: string, region?: string, model: string }} */
    this._auth = resolveAuthConfig();

    /** @type {string} */
    this._model = this._auth.model;

    /** @type {string} */
    this._systemInstruction = systemInstruction;

    /** @type {string | undefined} */
    this._resumptionToken = resumptionToken;

    /** @type {WebSocket | null} */
    this.ws = null;

    /** @type {boolean} */
    this.isReady = false;

    // ---- Callback properties (set externally) ----

    /** @type {(() => void) | null} */
    this.onReady = null;

    /** @type {((base64data: string) => void) | null} */
    this.onAudio = null;

    /** @type {(() => void) | null} */
    this.onInterrupted = null;

    /** @type {((token: string) => void) | null} */
    this.onResumptionToken = null;

    /** @type {(() => void) | null} */
    this.onGoAway = null;

    /** @type {((code: number, reason: string) => void) | null} */
    this.onClose = null;

    /** @type {((error: Error) => void) | null} */
    this.onError = null;
  }

  /**
   * Opens the WebSocket to Gemini and sends the mandatory
   * BidiGenerateContentSetup message once connected.
   *
   * @returns {Promise<void>} Resolves when the WebSocket connection is open.
   */
  async connect() {
    let url;
    /** @type {Record<string, string> | undefined} */
    let headers;

    if (this._auth.mode === 'vertex') {
      const token = await getAccessToken();
      const endpoint = VERTEX_WS_TEMPLATE.replace('{REGION}', this._auth.region);
      url = endpoint;
      headers = { Authorization: `Bearer ${token}` };
      log.info('Connecting via Vertex AI', { model: this._model, region: this._auth.region });
    } else {
      url = `${AISTUDIO_WS_BASE}?key=${this._auth.apiKey}`;
      log.info('Connecting via AI Studio', { model: this._model });
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url, { headers });

      this.ws.on('open', () => {
        log.info('WebSocket open, sending setup message');
        this._sendSetup();
        resolve();
      });

      this.ws.on('message', (raw) => {
        this._handleMessage(raw);
      });

      this.ws.on('close', (code, reason) => {
        const reasonStr = reason?.toString() || '';
        log.info('WebSocket closed', { code, reason: reasonStr });
        this.isReady = false;
        this.onClose?.(code, reasonStr);
      });

      this.ws.on('error', (err) => {
        log.error('WebSocket error', { error: err.message });
        this.onError?.(err);
        // Reject only if we have not yet resolved (still connecting).
        reject(err);
      });
    });
  }

  /**
   * Sends a base64-encoded PCM audio chunk to Gemini.
   *
   * Audio format: 16-bit PCM, 16 kHz, mono.
   * Silently drops the chunk if the session is not yet ready.
   *
   * @param {string} base64PCM — base64-encoded audio data
   */
  sendAudio(base64PCM) {
    if (!this.isReady) {
      return;
    }

    const message = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64PCM,
          },
        ],
      },
    };

    this._send(message);
  }

  /**
   * Closes the WebSocket connection to Gemini.
   */
  close() {
    if (this.ws) {
      log.info('Closing Gemini session');
      this.ws.close();
      this.ws = null;
      this.isReady = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds and sends the BidiGenerateContentSetup message.
   * This MUST be the first message sent after the WebSocket opens.
   *
   * @private
   */
  _sendSetup() {
    /** @type {Record<string, unknown>} */
    const sessionResumption = {};
    if (this._resumptionToken) {
      sessionResumption.handle = this._resumptionToken;
      log.info('Resuming session with existing token');
    }

    // Vertex AI: "projects/{project}/locations/{region}/publishers/google/models/{model}"
    // AI Studio: "models/{model}"
    const modelPath =
      this._auth.mode === 'vertex'
        ? `projects/${this._auth.project}/locations/${this._auth.region}/publishers/google/models/${this._model}`
        : this._model;

    const setup = {
      setup: {
        model: modelPath,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Aoede',
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: this._systemInstruction }],
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
          },
        },
        contextWindowCompression: {
          slidingWindow: {
            targetTokens: 1000,
          },
        },
        sessionResumption,
      },
    };

    this._send(setup);
  }

  /**
   * Parses an incoming Gemini message and dispatches to the appropriate
   * callback.
   *
   * @param {Buffer | ArrayBuffer | Buffer[]} raw
   * @private
   */
  _handleMessage(raw) {
    /** @type {Record<string, unknown>} */
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      log.error('Failed to parse Gemini message', { error: err.message });
      this.onError?.(err);
      return;
    }

    // 1. Setup acknowledgement
    if (msg.setupComplete !== undefined) {
      log.info('Gemini setup complete');
      this.isReady = true;
      this.onReady?.();
      return;
    }

    // 2. Server content (audio chunks and interruptions)
    if (msg.serverContent) {
      const sc = msg.serverContent;

      if (sc.interrupted === true) {
        log.info('Gemini interrupted by user speech');
        this.onInterrupted?.();
      }

      if (sc.modelTurn?.parts) {
        for (const part of sc.modelTurn.parts) {
          if (part.inlineData?.data) {
            this.onAudio?.(part.inlineData.data);
          }
        }
      }

      return;
    }

    // 3. Session resumption token
    if (msg.sessionResumptionUpdate?.handle) {
      const token = msg.sessionResumptionUpdate.handle;
      log.info('Received session resumption token');
      this.onResumptionToken?.(token);
      return;
    }

    // 4. Go-away signal (server will close soon)
    if (msg.goAway !== undefined) {
      log.warn('Received goAway from Gemini');
      this.onGoAway?.();
      return;
    }
  }

  /**
   * Serializes and sends a JSON message over the WebSocket.
   *
   * @param {Record<string, unknown>} message
   * @private
   */
  _send(message) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      log.warn('Attempted to send on a closed WebSocket');
      return;
    }

    this.ws.send(JSON.stringify(message));
  }
}

export { GeminiSession };
