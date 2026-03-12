'use strict';

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------
// Assembles the system instruction for the Gemini Live historian persona by
// combining a static base persona with the dynamic documentary context
// retrieved from Firestore.
// ---------------------------------------------------------------------------

/**
 * @typedef {import('./firestore-context').DocumentaryContext} DocumentaryContext
 */

/** Hard cap on total system instruction length (characters). */
const MAX_SYSTEM_CHARS = 30_000;

/** Static base persona injected at the start of every system instruction. */
const BASE_PERSONA = `You are the AI Historian \u2014 a knowledgeable, eloquent narrator of a cinematic documentary generated from a historical document the user uploaded. Reference specific segment titles and sources when asked. Never fabricate facts. When interrupted, stop immediately, answer, then offer to resume. When a viewer asks about something visual \u2014 places, events, people, objects \u2014 naturally mention you're creating an illustration. Say something like "Let me paint that picture for you..." or "Imagine this scene..." to prime the viewer for the illustration that will appear moments later.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format the segments array into a readable text block.
 *
 * @param {import('./firestore-context').SegmentContext[]} segments
 * @returns {string}
 */
function formatSegments(segments) {
  if (!segments || segments.length === 0) return '(no segments generated yet)';

  return segments
    .map((seg, i) => {
      const lines = [`Segment ${i + 1}: ${seg.title}`];
      if (seg.mood) lines.push(`  Mood: ${seg.mood}`);
      if (seg.script) lines.push(`  Script: ${seg.script}`);
      if (seg.sources.length > 0) {
        lines.push(`  Sources: ${seg.sources.join('; ')}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the complete system instruction for the Gemini Live session.
 *
 * Structure:
 *   1. Static base persona
 *   2. "=== DOCUMENTARY CONTEXT ===" block with visual bible, language,
 *      and per-segment details
 *
 * If the total exceeds {@link MAX_SYSTEM_CHARS} the text is sliced from the
 * end (segments are truncated first since the persona must remain intact).
 *
 * @param {DocumentaryContext | null} context
 * @returns {string}
 */
function buildSystemInstruction(context) {
  if (!context) {
    return BASE_PERSONA;
  }

  const contextLines = ['', '=== DOCUMENTARY CONTEXT ===', ''];

  if (context.language) {
    contextLines.push(`Document language: ${context.language}`);
    contextLines.push('');
  }

  if (context.visualBible) {
    contextLines.push('Visual Bible (overall visual direction):');
    contextLines.push(context.visualBible);
    contextLines.push('');
  }

  contextLines.push('Documentary Segments:');
  contextLines.push(formatSegments(context.segments));

  let full = BASE_PERSONA + '\n' + contextLines.join('\n');

  // Hard cap: slice from the end to preserve the persona header
  if (full.length > MAX_SYSTEM_CHARS) {
    full = full.slice(0, MAX_SYSTEM_CHARS - 3) + '...';
  }

  return full;
}

module.exports = { buildSystemInstruction, BASE_PERSONA, MAX_SYSTEM_CHARS };
