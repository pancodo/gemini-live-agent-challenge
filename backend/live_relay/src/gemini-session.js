/**
 * Manages a WebSocket connection to the Gemini Live API.
 *
 * Handles the full lifecycle: connection, BidiGenerateContentSetup handshake,
 * bidirectional audio streaming, interruption detection, session resumption,
 * and graceful shutdown via goAway.
 *
 * @module gemini-session
 */

import WebSocket from 'ws';
import { createLogger } from './logger.js';

const log = createLogger('gemini-session');

const DEFAULT_MODEL = 'models/gemini-2.5-flash-native-audio-preview-12-2025';

const GEMINI_WS_BASE =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

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
   * @param {string}  options.apiKey           — Gemini API key
   * @param {string}  [options.model]          — model resource name
   * @param {string}  options.systemInstruction — persona prompt text
   * @param {string}  [options.resumptionToken] — optional handle for session resumption
   */
  constructor({ apiKey, model, systemInstruction, resumptionToken }) {
    if (!apiKey) throw new Error('apiKey is required');
    if (!systemInstruction) throw new Error('systemInstruction is required');

    /** @type {string} */
    this._apiKey = apiKey;

    /** @type {string} */
    this._model = model || DEFAULT_MODEL;

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
  connect() {
    return new Promise((resolve, reject) => {
      const url = `${GEMINI_WS_BASE}?key=${this._apiKey}`;

      log.info('Connecting to Gemini Live API', { model: this._model });

      this.ws = new WebSocket(url);

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

    const setup = {
      setup: {
        model: this._model,
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
            startOfSpeechSensitivity: 'START_OF_SPEECH_SENSITIVITY_HIGH',
            endOfSpeechSensitivity: 'END_OF_SPEECH_SENSITIVITY_HIGH',
            prefixPaddingMs: 100,
            silenceDurationMs: 1000,
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
