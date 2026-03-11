"""Entity extractor -- maps narration entities to PDF page locations.

Called at the end of ScriptAgentOrchestrator for each segment.
Uses Gemini 2.0 Flash with structured output to find entity spans.
"""
from __future__ import annotations

import logging
from typing import Any

from google import genai
from google.genai import types as genai_types

logger = logging.getLogger(__name__)

_MAX_ENTITIES = 10

_EXTRACTION_PROMPT = """\
You are a named-entity extractor for a historical documentary system.

Given a narration script and a set of PDF page texts, find named entities
(people, places, dates, artifacts, organisations) mentioned in the narration
that also appear verbatim in one of the page texts.

Rules:
- Return at most {max_entities} entities.
- Each entity must be a substring that appears EXACTLY (case-insensitive match
  is acceptable) in at least one page text.
- Prefer proper nouns, specific dates, and artifact names over generic terms.
- Do not return duplicates.
- For each entity, return the 0-based page index where it first appears.

Narration script:
{narration}

Page texts (index = 0-based page number):
{pages}

Return a JSON array of objects with these fields:
- "text": the entity string as it appears in the narration
- "pageNumber": 0-based page index where the entity appears in the PDF
"""

_RESPONSE_SCHEMA = genai_types.Schema(
    type=genai_types.Type.ARRAY,
    items=genai_types.Schema(
        type=genai_types.Type.OBJECT,
        properties={
            "text": genai_types.Schema(type=genai_types.Type.STRING),
            "pageNumber": genai_types.Schema(type=genai_types.Type.INTEGER),
        },
        required=["text", "pageNumber"],
    ),
)


async def extract_entities(
    narration_script: str,
    page_texts: list[str],
    segment_id: str,
) -> list[dict[str, Any]]:
    """Extract named entities from narration and map to PDF page offsets.

    Returns list of EntityHighlight dicts: { text, segmentId, pageNumber, charOffset }
    """
    if not narration_script or not page_texts:
        return []

    try:
        # Build truncated page text representation (avoid token overflow)
        pages_str_parts: list[str] = []
        for idx, text in enumerate(page_texts):
            # Limit each page to 2000 chars to stay within context
            truncated = text[:2000]
            pages_str_parts.append(f"--- PAGE {idx} ---\n{truncated}")
        pages_str = "\n\n".join(pages_str_parts)

        prompt = _EXTRACTION_PROMPT.format(
            max_entities=_MAX_ENTITIES,
            narration=narration_script,
            pages=pages_str,
        )

        client = genai.Client()
        response = await client.aio.models.generate_content(
            model="gemini-2.0-flash",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=_RESPONSE_SCHEMA,
                temperature=0.1,
            ),
        )

        if not response.text:
            logger.warning("Entity extraction returned empty response for segment %s", segment_id)
            return []

        import json
        raw_entities: list[dict[str, Any]] = json.loads(response.text)

        # Validate, deduplicate, and compute charOffset
        highlights: list[dict[str, Any]] = []
        seen_texts: set[str] = set()

        for entity in raw_entities:
            text = entity.get("text", "").strip()
            page_num = entity.get("pageNumber", -1)

            if not text or text.lower() in seen_texts:
                continue
            if not isinstance(page_num, int) or page_num < 0 or page_num >= len(page_texts):
                continue

            # Find actual charOffset in the page text
            page_content = page_texts[page_num]
            char_offset = page_content.lower().find(text.lower())
            if char_offset < 0:
                # Entity not actually found on claimed page -- search all pages
                found = False
                for alt_page, alt_content in enumerate(page_texts):
                    alt_offset = alt_content.lower().find(text.lower())
                    if alt_offset >= 0:
                        page_num = alt_page
                        char_offset = alt_offset
                        found = True
                        break
                if not found:
                    continue

            seen_texts.add(text.lower())
            highlights.append({
                "text": text,
                "segmentId": segment_id,
                "pageNumber": page_num,
                "charOffset": char_offset,
            })

            if len(highlights) >= _MAX_ENTITIES:
                break

        logger.info(
            "Extracted %d entity highlights for segment %s",
            len(highlights),
            segment_id,
        )
        return highlights

    except Exception as exc:
        logger.warning(
            "Entity extraction failed for segment %s: %s",
            segment_id,
            exc,
        )
        return []
