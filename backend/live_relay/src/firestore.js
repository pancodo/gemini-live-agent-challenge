/**
 * Firestore access layer for the live-relay service.
 *
 * Provides session context reads and resumption token
 * persistence for the Gemini Live API WebSocket relay.
 *
 * @module firestore
 */

import { Firestore } from '@google-cloud/firestore';
import { createLogger } from './logger.js';

const log = createLogger('firestore');

/** @type {Firestore | null} */
let _db = null;

/**
 * Returns a lazily-initialized Firestore client singleton.
 *
 * The project ID is read from the `GCP_PROJECT_ID` environment variable.
 * On Cloud Run this is set automatically; locally it must be provided.
 *
 * @returns {Firestore}
 */
/** @type {boolean} */
let _firestoreAvailable = true;

function getDb() {
  if (!_firestoreAvailable) return null;
  if (!_db) {
    // Skip Firestore if no credentials are configured
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GCLOUD_PROJECT) {
      _firestoreAvailable = false;
      log.warn('No GCP credentials found, Firestore disabled');
      return null;
    }
    const projectId = process.env.GCP_PROJECT_ID;
    _db = new Firestore({ projectId });
    log.info('Firestore client initialized', { projectId: projectId ?? 'default' });
  }
  return _db;
}

/**
 * Reads session context written by the research pipeline.
 *
 * @param {string} sessionId
 * @returns {Promise<{ documentSummary: string, visualBible: string }>}
 */
export async function getSessionContext(sessionId) {
  const db = getDb();
  if (!db) return { documentSummary: '', visualBible: '' };
  const docRef = db.doc(`sessions/${sessionId}`);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    log.warn('Session document not found', { sessionId });
    return { documentSummary: '', visualBible: '' };
  }

  const data = snapshot.data();
  const documentSummary = data?.document_map ?? '';
  const visualBible = data?.visualBible ?? '';

  log.info('Session context loaded', {
    sessionId,
    hasDocumentSummary: documentSummary !== '',
    hasVisualBible: visualBible !== '',
  });

  return { documentSummary, visualBible };
}

/**
 * Persists a Gemini Live API session resumption token.
 *
 * The token is valid for up to 2 hours and allows reconnecting
 * to the same server-side session after a `goAway` or disconnect.
 *
 * @param {string} sessionId
 * @param {string} token - The resumption handle from `sessionResumptionUpdate`.
 * @returns {Promise<void>}
 */
export async function writeResumptionToken(sessionId, token) {
  const db = getDb();
  if (!db) return;
  const docRef = db.doc(`sessions/${sessionId}/liveSession/current`);

  await docRef.set(
    {
      resumptionToken: token,
      lastConnectedAt: Firestore.Timestamp.now(),
    },
    { merge: true },
  );

  log.info('Resumption token written', { sessionId });
}

/**
 * Reads a previously stored resumption token for the given session.
 *
 * @param {string} sessionId
 * @returns {Promise<string | null>} The resumption token, or `null` if none exists.
 */
export async function readResumptionToken(sessionId) {
  const db = getDb();
  if (!db) return null;
  const docRef = db.doc(`sessions/${sessionId}/liveSession/current`);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    log.info('No resumption token found', { sessionId });
    return null;
  }

  const token = snapshot.data()?.resumptionToken ?? null;

  log.info('Resumption token read', {
    sessionId,
    hasToken: token !== null,
  });

  return token;
}
