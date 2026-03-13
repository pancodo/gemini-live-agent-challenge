// ─────────────────────────────────────────────────────────────────────────────
// EntityPill — inline NER highlight pills for FactsTab
// ─────────────────────────────────────────────────────────────────────────────
// Implements the displaCy ENT pattern: pure regex, no NLP library, no side
// effects. parseEntities() returns an array of TextSegment covering the full
// input string with no gaps, then FactText renders each segment as either a
// plain <span> or a colored <EntityPill>.
// ─────────────────────────────────────────────────────────────────────────────

import { useMemo } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

export type EntityType = 'year' | 'person' | 'place' | 'other';

export interface TextSegment {
  text: string;
  type: EntityType | 'plain';
}

// Internal span used during detection — never exposed from this module.
interface DetectedSpan {
  start: number;
  end: number;
  type: EntityType;
}

// ── Static place name list (~60 common historical places) ────────────────────

const KNOWN_PLACES: readonly string[] = [
  'Ottoman Empire',
  'Istanbul',
  'Constantinople',
  'Egypt',
  'Cairo',
  'Rome',
  'Paris',
  'London',
  'Vienna',
  'Berlin',
  'Moscow',
  'Jerusalem',
  'Baghdad',
  'Persia',
  'India',
  'China',
  'Japan',
  'Greece',
  'Athens',
  'Sparta',
  'Venice',
  'Florence',
  'Milan',
  'Spain',
  'Portugal',
  'Arabia',
  'Damascus',
  'Mecca',
  'Medina',
  'Carthage',
  'Alexandria',
  'Babylon',
  'Byzantium',
  'Anatolia',
  'Balkans',
  'Crimea',
  'Hungary',
  'Poland',
  'France',
  'England',
  'Scotland',
  'Ireland',
  'Netherlands',
  'Belgium',
  'Switzerland',
  'Austria',
  'Prussia',
  'Sweden',
  'Denmark',
  'Norway',
  'Russia',
  'Serbia',
  'Bulgaria',
  'Romania',
  'Morocco',
  'Tunisia',
  'Libya',
  'Sudan',
  'Ethiopia',
  'Mediterranean',
];

// Sort longest first so multi-word names are matched before their substrings.
const PLACES_SORTED = [...KNOWN_PLACES].sort((a, b) => b.length - a.length);

// Pre-compiled regexes — created once at module init, not on every parseEntities call.
const PLACE_REGEXES: [string, RegExp][] = PLACES_SORTED.map((p) => [
  p,
  new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'),
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true when [newStart, newEnd) overlaps any span already in `spans`.
 * Uses half-open interval semantics (end is exclusive).
 */
function overlaps(spans: DetectedSpan[], newStart: number, newEnd: number): boolean {
  return spans.some((s) => newStart < s.end && newEnd > s.start);
}

// ── parseEntities ─────────────────────────────────────────────────────────────

/**
 * Pure function — no React, no side effects.
 *
 * Pass 1 — years:  /\b(1[0-9]{3}|20[0-2][0-9])\b/g
 * Pass 2 — places: static list matched whole-word, case-insensitive, no overlap
 * Pass 3 — persons: remaining Title Case tokens not at sentence start
 * Remainder: plain
 *
 * Returns array of TextSegment covering the ENTIRE input string with no gaps.
 */
export function parseEntities(text: string): TextSegment[] {
  const spans: DetectedSpan[] = [];

  // ── Pass 1: Years ───────────────────────────────────────────────────────────
  const yearRe = /\b(1[0-9]{3}|20[0-2][0-9])\b/g;
  let m: RegExpExecArray | null;
  while ((m = yearRe.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (!overlaps(spans, start, end)) {
      spans.push({ start, end, type: 'year' });
    }
  }

  // ── Pass 2: Known places ────────────────────────────────────────────────────
  for (const [, placeRe] of PLACE_REGEXES) {
    // Reset lastIndex since these are module-level regexes with 'g' flag.
    placeRe.lastIndex = 0;
    while ((m = placeRe.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (!overlaps(spans, start, end)) {
        spans.push({ start, end, type: 'place' });
      }
    }
  }

  // ── Pass 3: Person (Title Case tokens not at sentence start) ────────────────
  // Strategy: find uppercase-initial word sequences. Exclude those that
  // immediately follow a sentence boundary (start of string, or after
  // ". ", "! ", "? " patterns).
  const titleRe = /\b([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,})*)\b/g;
  while ((m = titleRe.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;

    // Skip if already claimed by year or place.
    if (overlaps(spans, start, end)) continue;

    // Skip if at sentence start: position 0 or preceded by [.!?] + whitespace.
    const isSentenceStart =
      start === 0 ||
      /[.!?]\s+$/.test(text.slice(0, start));

    if (isSentenceStart) continue;

    spans.push({ start, end, type: 'person' });
  }

  // ── Sort spans by start position ─────────────────────────────────────────────
  spans.sort((a, b) => a.start - b.start);

  // ── Build TextSegment array with no gaps ─────────────────────────────────────
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const span of spans) {
    // Plain text before this span.
    if (cursor < span.start) {
      segments.push({ text: text.slice(cursor, span.start), type: 'plain' });
    }
    segments.push({ text: text.slice(span.start, span.end), type: span.type });
    cursor = span.end;
  }

  // Remaining plain text after the last span.
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), type: 'plain' });
  }

  // Edge case: empty input or no content at all.
  if (segments.length === 0) {
    segments.push({ text, type: 'plain' });
  }

  return segments;
}

// ── EntityPill ────────────────────────────────────────────────────────────────

interface EntityPillProps {
  text: string;
  type: EntityType;
}

const pillStyles: Record<EntityType, string> = {
  year:   'bg-[var(--gold)]/12 text-[var(--gold-d)] border-[var(--gold)]/30',
  person: 'bg-[var(--teal)]/10 text-[var(--teal)] border-[var(--teal)]/25',
  place:  'bg-purple-500/8 text-purple-400 border-purple-500/20',
  other:  'bg-[var(--muted)]/8 text-[var(--muted)] border-[var(--muted)]/15',
};

export function EntityPill({ text, type }: EntityPillProps) {
  return (
    <span
      className={`inline px-1.5 py-0.5 rounded text-[11px] font-sans border mx-0.5 leading-none ${pillStyles[type]}`}
    >
      {text}
    </span>
  );
}

// ── FactText ──────────────────────────────────────────────────────────────────

interface FactTextProps {
  fact: string;
}

export function FactText({ fact }: FactTextProps) {
  const segments = useMemo(() => parseEntities(fact), [fact]);

  // Fallback: if no entity segments found, render as plain text.
  const hasEntities = segments.some((s) => s.type !== 'plain');
  if (!hasEntities) {
    return (
      <p className="font-sans text-[12px] text-[var(--text)] leading-relaxed">
        {fact}
      </p>
    );
  }

  return (
    <p className="font-sans text-[12px] text-[var(--text)] leading-relaxed">
      {segments.map((seg, i) =>
        seg.type === 'plain' ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <EntityPill key={i} text={seg.text} type={seg.type} />
        )
      )}
    </p>
  );
}
