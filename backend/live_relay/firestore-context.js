'use strict';

const { Firestore } = require('@google-cloud/firestore');

// ---------------------------------------------------------------------------
// Firestore Context Fetcher
// ---------------------------------------------------------------------------
// Retrieves documentary context for a given session so the Gemini Live
// historian persona can reference specific segment titles, sources, and the
// visual bible when conversing with the user.
// ---------------------------------------------------------------------------

/** @type {Firestore | null} */
let _db = null;

/**
 * Lazily initialise and return the Firestore client.
 *
 * In Cloud Run the default credentials are injected automatically via
 * Workload Identity. Locally, GOOGLE_APPLICATION_CREDENTIALS must point
 * at a service-account key.
 *
 * @returns {Firestore}
 */
function getFirestore() {
  if (!_db) {
    _db = new Firestore({
      projectId: process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT,
    });
  }
  return _db;
}

// ---------------------------------------------------------------------------
// Types (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SegmentContext
 * @property {string}   id
 * @property {string}   title
 * @property {string}   script
 * @property {string}   mood
 * @property {string[]} sources
 */

/**
 * @typedef {Object} DocumentaryContext
 * @property {string}            visualBible
 * @property {string}            language
 * @property {SegmentContext[]}  segments
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch documentary context for a session from Firestore.
 *
 * Reads the session document for `visualBible` and `language`, then reads
 * all segment sub-documents for title, script, mood, and sources.
 *
 * Returns a lightweight context object suitable for prompt injection.
 * If the session does not exist or has no segments, the returned object
 * will contain empty/default values so callers never need null-checks.
 *
 * @param {string} sessionId
 * @returns {Promise<DocumentaryContext>}
 */
async function fetchDocumentaryContext(sessionId) {
  const db = getFirestore();

  /** @type {DocumentaryContext} */
  const result = {
    visualBible: '',
    language: '',
    segments: [],
  };

  // ── Session document ────────────────────────────────────────────
  const sessionRef = db.collection('sessions').doc(sessionId);
  const sessionSnap = await sessionRef.get();

  if (sessionSnap.exists) {
    const data = sessionSnap.data();
    result.visualBible = data?.visualBible ?? '';
    result.language = data?.language ?? '';
  }

  // ── Segments sub-collection ─────────────────────────────────────
  const segmentsSnap = await sessionRef
    .collection('segments')
    .orderBy('createdAt', 'asc')
    .get();

  for (const doc of segmentsSnap.docs) {
    const d = doc.data();
    result.segments.push({
      id: doc.id,
      title: d?.title ?? '',
      script: d?.script ?? '',
      mood: d?.mood ?? '',
      sources: Array.isArray(d?.sources) ? d.sources : [],
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Session Resumption Token Persistence
// ---------------------------------------------------------------------------

/**
 * Save a Gemini session resumption token to Firestore.
 *
 * Written to `/sessions/{sessionId}/liveSession` so the token survives
 * relay restarts (Cloud Run cold starts). Fire-and-forget — callers should
 * `.catch()` to avoid unhandled rejections.
 *
 * @param {string} sessionId
 * @param {string} token
 * @returns {Promise<void>}
 */
async function saveResumptionToken(sessionId, token) {
  const db = getFirestore();
  await db
    .collection('sessions')
    .doc(sessionId)
    .collection('liveSession')
    .doc('state')
    .set(
      {
        resumptionToken: token,
        lastConnectedAt: Firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
}

/**
 * Load a previously stored resumption token from Firestore.
 *
 * Returns `null` if no token exists or the document is missing.
 *
 * @param {string} sessionId
 * @returns {Promise<string | null>}
 */
async function loadResumptionToken(sessionId) {
  const db = getFirestore();
  const snap = await db
    .collection('sessions')
    .doc(sessionId)
    .collection('liveSession')
    .doc('state')
    .get();

  if (!snap.exists) return null;
  return snap.data()?.resumptionToken ?? null;
}

module.exports = {
  fetchDocumentaryContext,
  getFirestore,
  saveResumptionToken,
  loadResumptionToken,
};
