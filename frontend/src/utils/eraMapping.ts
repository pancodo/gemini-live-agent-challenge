import type { PortraitEra, Segment, SegmentGeo } from '../types';

const ERA_KEYWORDS: Record<Exclude<PortraitEra, 'default'>, string[]> = {
  ancient: [
    'ancient', 'egypt', 'rome', 'roman', 'greek', 'greece', 'mesopotamia',
    'pharaoh', 'bronze age', 'iron age', 'persian', 'sumerian', 'babylon',
    'alexander', 'sparta', 'athens', 'julius caesar', 'cleopatra',
  ],
  modern: [
    'modern', '19th century', '20th century', '21st century', 'industrial',
    'world war', 'cold war', 'nuclear', 'vietnam', 'revolution',
    'napoleon', 'victorian', 'colonial', 'empire', 'independence',
    'telegraph', 'railway', 'airplane',
  ],
};

/**
 * Resolve the portrait era for a segment by checking:
 * 1. Explicit era on geo events
 * 2. Keyword matching on segment title + script + mood
 */
export function resolveEra(segment: Segment, geo?: SegmentGeo): PortraitEra {
  // Check explicit era on geo events
  if (geo?.events?.length) {
    const eraFromGeo = geo.events[0].era;
    if (eraFromGeo && eraFromGeo in ERA_KEYWORDS) return eraFromGeo as PortraitEra;
  }

  // Keyword match on segment text
  const text = `${segment.title} ${segment.script} ${segment.mood}`.toLowerCase();
  for (const [era, keywords] of Object.entries(ERA_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) return era as PortraitEra;
  }

  return 'default';
}
