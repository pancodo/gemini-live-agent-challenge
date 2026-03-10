/**
 * Bridges one browser WebSocket connection to one Gemini Live API
 * WebSocket connection, forming the core relay for real-time voice
 * interaction with the historian persona.
 *
 * Handles session initialization, bidirectional audio forwarding,
 * server-side reconnection on `goAway`, and resumption token
 * persistence through Firestore.
 *
 * @module relay-session
 */

import { GeminiSession } from './gemini-session.js';
import {
  getSessionContext,
  writeResumptionToken,
  readResumptionToken,
} from './firestore.js';
import { buildSystemInstruction } from './persona.js';
import { createLogger } from './logger.js';

const log = createLogger('relay-session');

/** WebSocket OPEN readyState constant (from the `ws` library). */
const WS_OPEN = 1;

/** Maximum number of server-side reconnection attempts on goAway. */
const MAX_RECONNECT_ATTEMPTS = 3;

/** Base delay in ms for exponential backoff (1000 * 3^attempt). */
const RECONNECT_BASE_MS = 1000;

class RelaySession {
  /**
   * @param {import('ws').WebSocket} browserWs - The browser's WebSocket connection.
   * @param {string} sessionId - The Firestore session identifier.
   * @param {Object} [options]
   * @param {string} [options.resumptionToken] - Optional resumption token from URL query param.
   */
  constructor(browserWs, sessionId, options = {}) {
    /** @type {import('ws').WebSocket} */
    this._browserWs = browserWs;

    /** @type {string} */
    this._sessionId = sessionId;

    /** @type {string | null} */
    this._resumptionToken = options.resumptionToken ?? null;

    /** @type {GeminiSession | null} */
    this._geminiSession = null;

    /** @type {boolean} */
    this._destroyed = false;
  }

  /**
   * Initializes the relay bridge.
   *
   * Reads session context from Firestore, builds the historian system
   * instruction, resolves a resumption token, creates the Gemini session,
   * wires up all callbacks, and establishes the connection.
   *
   * @returns {Promise<void>}
   */
  async start() {
    try {
      // --- Load session context from Firestore ---
      let documentSummary = '';
      let visualBible = '';

      try {
        const context = await getSessionContext(this._sessionId);
        documentSummary = context.documentSummary;
        visualBible = context.visualBible;
      } catch (err) {
        log.error('Failed to read session context from Firestore', {
          sessionId: this._sessionId,
          error: err.message,
        });
        // Continue with empty defaults rather than crashing the relay.
      }

      const instruction = buildSystemInstruction({ documentSummary, visualBible });

      // --- Resolve resumption token ---
      let resumptionToken = this._resumptionToken;

      if (!resumptionToken) {
        try {
          resumptionToken = await readResumptionToken(this._sessionId);
        } catch (err) {
          log.error('Failed to read resumption token from Firestore', {
            sessionId: this._sessionId,
            error: err.message,
          });
          // Proceed without a resumption token.
        }
      }

      if (resumptionToken) {
        this._resumptionToken = resumptionToken;
        log.info('Using resumption token', { sessionId: this._sessionId });
      }

      // --- Create and connect the Gemini session ---
      this._geminiSession = this._createGeminiSession(instruction, resumptionToken);
      await this._geminiSession.connect();

      // --- Wire up browser WebSocket event handlers ---
      this._wireBrowserHandlers();

      log.info('Relay session started', { sessionId: this._sessionId });
    } catch (err) {
      log.error('Failed to initialize relay session', {
        sessionId: this._sessionId,
        error: err.message,
      });
      this._sendToBrowser({ type: 'error', message: 'Failed to initialize session' });
    }
  }

  /**
   * Creates a GeminiSession instance with all relay callbacks wired up.
   *
   * @param {string} systemInstruction - The historian persona system instruction.
   * @param {string | null} resumptionToken - Optional resumption token for session continuity.
   * @returns {GeminiSession}
   * @private
   */
  _createGeminiSession(systemInstruction, resumptionToken) {
    const session = new GeminiSession({
      systemInstruction,
      resumptionToken,
    });

    session.onReady = () => {
      log.info('Gemini session ready', { sessionId: this._sessionId });
      this._sendToBrowser({ type: 'ready' });
    };

    session.onAudio = (data) => {
      this._sendToBrowser({ type: 'audio', data });
    };

    session.onInterrupted = () => {
      log.info('Gemini interrupted playback', { sessionId: this._sessionId });
      this._sendToBrowser({ type: 'interrupted' });
    };

    session.onResumptionToken = (token) => {
      this._resumptionToken = token;

      this._sendToBrowser({ type: 'resumption_token', token });

      // Persist to Firestore asynchronously; don't block the relay.
      writeResumptionToken(this._sessionId, token).catch((err) => {
        log.error('Failed to write resumption token to Firestore', {
          sessionId: this._sessionId,
          error: err.message,
        });
      });
    };

    session.onGoAway = () => {
      log.warn('Gemini sent goAway', { sessionId: this._sessionId });
      this._handleGoAway();
    };

    session.onClose = () => {
      log.info('Gemini session closed', { sessionId: this._sessionId });
      if (this._browserWs.readyState === WS_OPEN) {
        this._browserWs.close(1000, 'Gemini session ended');
      }
    };

    session.onError = (err) => {
      log.error('Gemini connection error', {
        sessionId: this._sessionId,
        error: err?.message ?? String(err),
      });
      this._sendToBrowser({ type: 'error', message: 'Gemini connection error' });
    };

    return session;
  }

  /**
   * Wires the browser WebSocket's `message`, `close`, and `error` events
   * to forward data to the Gemini session.
   *
   * @private
   */
  _wireBrowserHandlers() {
    this._browserWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);

        if (msg.type === 'audio' && this._geminiSession) {
          this._geminiSession.sendAudio(msg.data);
        }
      } catch (err) {
        log.error('Failed to parse browser message', {
          sessionId: this._sessionId,
          error: err.message,
        });
      }
    });

    this._browserWs.on('close', (code, reason) => {
      log.info('Browser WebSocket closed', {
        sessionId: this._sessionId,
        code,
        reason: reason?.toString() ?? '',
      });

      if (this._geminiSession) {
        this._geminiSession.close();
      }
    });

    this._browserWs.on('error', (err) => {
      log.error('Browser WebSocket error', {
        sessionId: this._sessionId,
        error: err.message,
      });
    });
  }

  /**
   * Handles a `goAway` signal from the Gemini Live API by attempting
   * server-side reconnection with exponential backoff.
   *
   * The browser WebSocket is kept alive throughout. If all reconnection
   * attempts fail, a `go_away` message is sent to the browser so it can
   * handle the disconnection on its end.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _handleGoAway() {
    const systemInstruction = this._geminiSession
      ? buildSystemInstruction(
          await getSessionContext(this._sessionId).catch(() => ({
            documentSummary: '',
            visualBible: '',
          })),
        )
      : '';

    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
      const delayMs = RECONNECT_BASE_MS * Math.pow(3, attempt);

      log.info('Attempting Gemini reconnection', {
        sessionId: this._sessionId,
        attempt: attempt + 1,
        delayMs,
      });

      await this._sleep(delayMs);

      // Don't attempt reconnection if the browser has disconnected.
      if (this._browserWs.readyState !== WS_OPEN) {
        log.info('Browser disconnected during reconnection, aborting', {
          sessionId: this._sessionId,
        });
        return;
      }

      try {
        const newSession = this._createGeminiSession(
          systemInstruction,
          this._resumptionToken,
        );

        await new Promise((resolve, reject) => {
          /** @type {ReturnType<typeof setTimeout>} */
          let timeout;

          const originalOnReady = newSession.onReady;
          newSession.onReady = () => {
            clearTimeout(timeout);
            originalOnReady();
            resolve(undefined);
          };

          const originalOnError = newSession.onError;
          newSession.onError = (err) => {
            clearTimeout(timeout);
            originalOnError(err);
            reject(err);
          };

          // Timeout after 15 seconds to avoid hanging indefinitely.
          timeout = setTimeout(() => {
            reject(new Error('Gemini reconnection timed out'));
          }, 15_000);

          newSession.connect().catch(reject);
        });

        // Reconnection succeeded — replace the old session.
        if (this._geminiSession) {
          // Detach old callbacks to prevent stale event handling.
          this._geminiSession.onClose = () => {};
          this._geminiSession.onError = () => {};
          this._geminiSession.close();
        }

        this._geminiSession = newSession;

        log.info('Gemini reconnection succeeded', {
          sessionId: this._sessionId,
          attempt: attempt + 1,
        });

        return;
      } catch (err) {
        log.error('Gemini reconnection attempt failed', {
          sessionId: this._sessionId,
          attempt: attempt + 1,
          error: err.message,
        });
      }
    }

    // All attempts exhausted.
    log.error('All Gemini reconnection attempts failed', {
      sessionId: this._sessionId,
    });

    this._sendToBrowser({ type: 'go_away' });
  }

  /**
   * Sends a JSON message to the browser WebSocket if it is still open.
   *
   * @param {Record<string, unknown>} obj - The message object to serialize and send.
   * @private
   */
  _sendToBrowser(obj) {
    if (this._browserWs.readyState === WS_OPEN) {
      this._browserWs.send(JSON.stringify(obj));
    }
  }

  /**
   * Returns a promise that resolves after the given number of milliseconds.
   *
   * @param {number} ms
   * @returns {Promise<void>}
   * @private
   */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Tears down the relay session, closing both WebSocket connections
   * if they are still open.
   */
  destroy() {
    if (this._destroyed) {
      return;
    }

    this._destroyed = true;

    log.info('Destroying relay session', { sessionId: this._sessionId });

    if (this._geminiSession) {
      this._geminiSession.close();
      this._geminiSession = null;
    }

    if (this._browserWs.readyState === WS_OPEN) {
      this._browserWs.close(1000, 'Relay session destroyed');
    }
  }
}

export { RelaySession };
