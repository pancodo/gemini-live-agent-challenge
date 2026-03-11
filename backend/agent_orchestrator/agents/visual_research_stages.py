"""Phase IV stage functions for the Visual Research Orchestrator.

Each function implements one stage of the per-scene micro-pipeline defined in
the design document.  Stages are pure async functions — they have no knowledge
of the ADK runtime, the SSE layer, or Firestore.  All side effects live in
``visual_research_orchestrator.py``.

Stage overview
--------------
Stage 0  generate_queries       Gemini 2.0 Flash — produces 4–6 search queries
Stage 1  discover_sources       google_search grounding — returns URLs + titles
Stage 2  detect_source_types    Gemini 2.0 Flash — classifies each URL
Stage 3  fetch_content          httpx / Wikipedia REST / Document AI / Gemini multimodal
Stage 4  dual_evaluate          Gemini 2.0 Flash — quality then relevance, per source
Stage 5  extract_details        Gemini 2.0 Flash — structured visual detail fragments
Stage 6  synthesize_manifest    Gemini 2.0 Pro  — merges fragments into final manifest

All I/O-bound work is fully async.  Concurrent calls within a stage are gated
by a shared ``asyncio.Semaphore`` to respect API rate limits.

Dependencies required in agent_orchestrator requirements:
    httpx>=0.27
    beautifulsoup4>=4.12
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from google import genai as google_genai
from google.cloud import documentai_v1 as documentai
from google.genai import types as genai_types

from .visual_detail_types import (
    DiscoveredSource,
    EvaluatedSource,
    FetchedContent,
    MergedVisualDetail,
    TypedSource,
    VisualDetailFragment,
    VisualDetailManifest,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------

_HTTPX_HEADERS: dict[str, str] = {
    "User-Agent": (
        "AI-Historian-Research-Bot/1.0 "
        "(AI documentary research pipeline; contact: ai-historian@example.com)"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

_FETCH_TIMEOUT: float = 12.0  # seconds
_MAX_CONTENT_CHARS: int = 8_000  # ~2 000 tokens — cap before evaluation

_VALID_SOURCE_TYPES = {"webpage", "pdf", "image", "wikipedia", "dataset", "unknown"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _strip_fences(text: str) -> str:
    """Remove markdown code fences from model output."""
    s = text.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[-1]
    if s.endswith("```"):
        s = s.rsplit("```", 1)[0]
    return s.strip()


def _extract_domain(url: str) -> str:
    """Return the netloc of a URL (e.g. 'en.wikipedia.org')."""
    try:
        return urlparse(url).netloc.lower()
    except Exception:
        return url


def _detect_image_mime(url: str) -> str:
    """Infer MIME type from URL extension, defaulting to image/jpeg."""
    lower = url.lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".gif"):
        return "image/gif"
    return "image/jpeg"


def _parse_json_list(text: str) -> list[Any]:
    """Parse a JSON array from model output, tolerating fences and envelopes."""
    cleaned = _strip_fences(text)
    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, list):
        return parsed
    if isinstance(parsed, dict):
        # Try common envelope keys
        for key in ("queries", "items", "results", "sources"):
            if key in parsed and isinstance(parsed[key], list):
                return parsed[key]
    return []


def _parse_json_object(text: str) -> dict[str, Any]:
    """Parse a JSON object from model output, tolerating fences."""
    cleaned = _strip_fences(text)
    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    return {}


# ---------------------------------------------------------------------------
# Stage 0 — Query Generation
# ---------------------------------------------------------------------------


async def stage_0_generate_queries(
    scene_brief: dict[str, Any],
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
) -> list[str]:
    """Generate 4–6 targeted visual reference search queries for a scene.

    Queries are designed to find archival photographs, period illustrations,
    museum catalogue entries, and primary-source materials — not general
    encyclopedia articles.

    Args:
        scene_brief: Serialised SceneBrief dict (era, location, key_entities, etc.).
        client: Shared google-genai async client.
        semaphore: Rate-limit gate for Gemini API calls.

    Returns:
        List of 4–6 specific search query strings, or an empty list on failure.
    """
    era = scene_brief.get("era", "unknown era")
    location = scene_brief.get("location", "unknown location")
    entities = scene_brief.get("key_entities", [])
    hook = scene_brief.get("cinematic_hook", "")
    mood = scene_brief.get("mood", "")
    excerpt = scene_brief.get("document_excerpt", "")[:400]
    narrative_role = scene_brief.get("narrative_role", "development")

    prompt = f"""\
You are building a targeted visual reference research set for an AI documentary scene.

Scene details:
- Era / period: {era}
- Location: {location}
- Key entities: {", ".join(entities[:8])}
- Cinematic hook: {hook}
- Mood: {mood}
- Narrative role in documentary: {narrative_role}
- Document excerpt: {excerpt}

Generate EXACTLY 5-7 queries. Include ALL of the following query types:
- At least 1 query targeting archival photographs or period illustrations (add "archival photograph" or "period illustration" or "museum collection" to the query)
- At least 1 query targeting academic/scholarly sources (add "academic study" or "JSTOR" or "primary source" or "site:jstor.org")
- At least 1 query for maps, manuscripts, or material culture objects (add "manuscript" or "map" or "museum artefact")
- At least 1 highly specific entity query using exact names and dates from the document excerpt
- At least 1 query for architectural or material details of the specific location/era

Rules:
- Every query MUST include the era/date AND the location/region
- Every query MUST include a specific subject (person, building, object, practice)
- Target institutional archives, museum collections, primary sources — not general history
- GOOD: "Ottoman bazaar 1750 Thessaloniki archival photograph"
- GOOD: "18th century Thessaloniki market woodcut illustration British Library"
- BAD:  "Ottoman Empire 18th century" (too generic)
- BAD:  "historical market" (no era or location)

Output ONLY a JSON array of query strings. No preamble, no explanation.
["query 1", "query 2", "query 3", "query 4", "query 5"]
"""

    async with semaphore:
        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    max_output_tokens=512,
                    temperature=0.2,
                ),
            )
        except Exception as exc:
            logger.warning("Stage 0 query generation failed: %s", exc)
            return []

    queries = _parse_json_list(response.text)
    valid = [q for q in queries if isinstance(q, str) and len(q) > 10]
    logger.debug("Stage 0: generated %d queries for scene %s", len(valid), scene_brief.get("scene_id"))
    return valid[:7]


# ---------------------------------------------------------------------------
# Stage 1 — Source Discovery
# ---------------------------------------------------------------------------


async def stage_1_discover_sources(
    queries: list[str],
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
    max_sources: int = 10,
) -> list[DiscoveredSource]:
    """Run Google Search grounding for each query and collect unique source URLs.

    Uses the google-genai SDK's native ``types.Tool(google_search=GoogleSearch())``
    grounding mechanism.  URLs are extracted from
    ``response.candidates[0].grounding_metadata.grounding_chunks``, which
    contains structured ``{web.uri, web.title}`` entries — no URL parsing
    from model text required.

    Deduplication is domain-based: only the first URL per domain is kept.
    This prevents five results from the same Wikipedia edition crowding out
    more diverse sources.

    Args:
        queries: List of search query strings from Stage 0.
        client: Shared google-genai async client.
        semaphore: Rate-limit gate.
        max_sources: Maximum unique sources to return (3 for fast path, 10 for deep path).

    Returns:
        List of ``DiscoveredSource`` objects, de-duplicated by domain, capped at ``max_sources``.
    """

    async def _search_one(query: str) -> list[DiscoveredSource]:
        async with semaphore:
            try:
                response = await client.aio.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=(
                        f"Find authoritative visual reference sources for this historical research query: {query}\n\n"
                        "Prefer sources from:\n"
                        "- Institutional archives (.edu, .gov, .museum, national archive domains)\n"
                        "- Academic databases (jstor.org, archive.org, hathitrust.org, europeana.eu)\n"
                        "- Museum collection databases and university press publications\n"
                        "- Primary source digitization projects\n\n"
                        "Return the most authoritative URLs found."
                    ),
                    config=genai_types.GenerateContentConfig(
                        tools=[genai_types.Tool(google_search=genai_types.GoogleSearch())],
                        max_output_tokens=128,
                    ),
                )
                sources: list[DiscoveredSource] = []
                if response.candidates:
                    meta = response.candidates[0].grounding_metadata
                    if meta and meta.grounding_chunks:
                        for chunk in meta.grounding_chunks:
                            if chunk.web and chunk.web.uri:
                                sources.append(
                                    DiscoveredSource(
                                        url=chunk.web.uri,
                                        title=chunk.web.title or "",
                                        snippet="",
                                    )
                                )
                return sources
            except Exception as exc:
                logger.warning("Stage 1 search failed for '%s': %s", query[:60], exc)
                return []

    # Run all query searches concurrently
    per_query_results = await asyncio.gather(*[_search_one(q) for q in queries])

    # Deduplicate by domain, preserving discovery order
    seen_domains: set[str] = set()
    collected: list[DiscoveredSource] = []

    for result_list in per_query_results:
        for src in result_list:
            domain = _extract_domain(src.url)
            if domain and domain not in seen_domains:
                seen_domains.add(domain)
                collected.append(src)
            if len(collected) >= max_sources:
                break
        if len(collected) >= max_sources:
            break

    logger.debug("Stage 1: discovered %d unique sources (cap %d)", len(collected), max_sources)
    return collected


# ---------------------------------------------------------------------------
# Stage 2 — Type Detection
# ---------------------------------------------------------------------------


async def stage_2_detect_types(
    sources: list[DiscoveredSource],
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
) -> list[TypedSource]:
    """Classify each discovered source by type (webpage, pdf, image, etc.).

    Fast URL-pattern heuristics handle the common cases (Wikipedia, .pdf, image
    extensions) without an API call.  Only ambiguous URLs make a Gemini call.

    Args:
        sources: Discovered sources from Stage 1.
        client: Shared google-genai async client.
        semaphore: Rate-limit gate.

    Returns:
        List of ``TypedSource`` objects in the same order as ``sources``.
    """

    async def _classify_one(src: DiscoveredSource) -> TypedSource:
        url_lower = src.url.lower()

        # Fast heuristics — no API call needed
        if "wikipedia.org" in url_lower or "wikimedia.org" in url_lower:
            return TypedSource(url=src.url, title=src.title, snippet=src.snippet, source_type="wikipedia")
        if url_lower.endswith(".pdf") or re.search(r"/pdf[/?#]|\.pdf\?", url_lower):
            return TypedSource(url=src.url, title=src.title, snippet=src.snippet, source_type="pdf")
        if re.search(r"\.(jpe?g|png|webp|gif|tiff?)([?#]|$)", url_lower):
            return TypedSource(url=src.url, title=src.title, snippet=src.snippet, source_type="image")
        if any(domain in url_lower for domain in ("jstor.org", "archive.org", "data.gov", "worldcat.org")):
            return TypedSource(url=src.url, title=src.title, snippet=src.snippet, source_type="dataset")

        # Gemini classification for ambiguous URLs
        async with semaphore:
            try:
                response = await client.aio.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=(
                        "Classify this URL as ONE of: webpage, pdf, image, wikipedia, dataset, unknown.\n"
                        "Output only the single word, nothing else.\n\n"
                        f"URL: {src.url}\nTitle: {src.title}"
                    ),
                    config=genai_types.GenerateContentConfig(
                        max_output_tokens=8,
                        temperature=0.0,
                    ),
                )
                raw = response.text.strip().lower()
                source_type = raw if raw in _VALID_SOURCE_TYPES else "webpage"
                return TypedSource(url=src.url, title=src.title, snippet=src.snippet, source_type=source_type)
            except Exception:
                return TypedSource(url=src.url, title=src.title, snippet=src.snippet, source_type="webpage")

    typed = list(await asyncio.gather(*[_classify_one(src) for src in sources]))
    logger.debug(
        "Stage 2: classified %d sources — %s",
        len(typed),
        {t: sum(1 for s in typed if s.source_type == t) for t in _VALID_SOURCE_TYPES},
    )
    return typed


# ---------------------------------------------------------------------------
# Stage 3 — Content Fetch
# ---------------------------------------------------------------------------


async def _fetch_webpage_text(url: str) -> str | None:
    """Fetch a webpage via httpx and extract clean article text with BeautifulSoup."""
    try:
        async with httpx.AsyncClient(
            timeout=_FETCH_TIMEOUT,
            follow_redirects=True,
            headers=_HTTPX_HEADERS,
        ) as http:
            resp = await http.get(url)
            resp.raise_for_status()
            html = resp.text
    except (httpx.HTTPError, httpx.RequestError) as exc:
        logger.debug("HTTP fetch failed for %s: %s", url, exc)
        return None

    soup = BeautifulSoup(html, "html.parser")

    # Remove noise elements
    for tag in soup(["script", "style", "nav", "footer", "noscript", "aside"]):
        tag.decompose()

    # Try semantic content containers first
    content = None
    for selector in ["article", "[role='main']", "main", ".article-body",
                      ".post-content", ".entry-content", ".mw-parser-output"]:
        content = soup.select_one(selector)
        if content:
            break
    if content is None:
        content = soup.body or soup

    lines = []
    for el in content.find_all(["p", "h1", "h2", "h3", "li", "blockquote"]):
        text = el.get_text(separator=" ", strip=True)
        if text and len(text) > 20:
            lines.append(text)

    return "\n".join(lines)[:_MAX_CONTENT_CHARS] if lines else None


async def _fetch_wikipedia_text(url: str) -> str | None:
    """Fetch a Wikipedia article via the REST summary API (no scraping needed)."""
    # Extract article title from URL
    match = re.search(r"/wiki/([^#?]+)", url)
    if not match:
        return await _fetch_webpage_text(url)

    title = match.group(1)
    api_url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"

    try:
        async with httpx.AsyncClient(timeout=_FETCH_TIMEOUT, headers=_HTTPX_HEADERS) as http:
            resp = await http.get(api_url)
            resp.raise_for_status()
            data = resp.json()
            extract = data.get("extract", "")
            if extract:
                return extract[:_MAX_CONTENT_CHARS]
    except Exception as exc:
        logger.debug("Wikipedia REST API failed for %s: %s", url, exc)

    # Fallback to full page scrape
    return await _fetch_webpage_text(url)


async def _fetch_pdf_text(url: str, processor_name: str | None) -> str | None:
    """Download a PDF via httpx and extract text via Document AI inline processing."""
    try:
        async with httpx.AsyncClient(
            timeout=30.0,  # PDFs can be large
            follow_redirects=True,
            headers=_HTTPX_HEADERS,
        ) as http:
            resp = await http.get(url)
            resp.raise_for_status()
            pdf_bytes = resp.content
    except Exception as exc:
        logger.debug("PDF download failed for %s: %s", url, exc)
        return None

    if not pdf_bytes:
        return None

    if processor_name:
        # Use Document AI for high-quality text extraction
        try:
            doc_client = documentai.DocumentProcessorServiceAsyncClient()
            request = documentai.ProcessRequest(
                name=processor_name,
                raw_document=documentai.RawDocument(
                    content=pdf_bytes,
                    mime_type="application/pdf",
                ),
            )
            response = await doc_client.process_document(request=request)
            text = response.document.text
            return text[:_MAX_CONTENT_CHARS] if text else None
        except Exception as exc:
            logger.warning("Document AI inline OCR failed for %s: %s", url, exc)
            # Fall through to plain bytes decode

    # Simple fallback: decode as UTF-8 (works for text-layer PDFs only)
    try:
        return pdf_bytes.decode("utf-8", errors="ignore")[:_MAX_CONTENT_CHARS]
    except Exception:
        return None


async def _fetch_image_description(
    url: str,
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
) -> str | None:
    """Describe an archival image from a URL using Gemini 2.0 Flash multimodal."""
    mime_type = _detect_image_mime(url)
    prompt = """\
Analyze this historical reference image. The image may be a photograph, painting, \
engraving, or manuscript illumination — describe what you see in a way that reflects \
the medium.

Output a JSON object with these fields:
- visual_description: 2-3 sentences describing the scene
- lighting: specific lighting conditions (e.g. "side-lit by oil lamp")
- materials: visible materials and textures (e.g. "worn stone floor")
- color_palette: dominant colors (e.g. "ochre, burnt sienna, verdigris")
- architecture: structural details visible (e.g. "low vaulted ceiling")
- clothing: garments and textiles visible (e.g. "embroidered kaftan")
- atmosphere: overall mood conveyed by the image (e.g. "dense, crowded market")
- era_markers: visible period cues (e.g. "oil lanterns, no electric lighting")
- subjects: array of short phrases describing people by activity/clothing/posture \
(not physical appearance), e.g. ["merchants in turbans arranging goods", \
"porter bent under heavy load"]. Empty array if no people visible.
- compositional_notes: spatial arrangement, foreground/background separation, depth \
cues, e.g. ["arcade in foreground frames distant crowd", "low horizon with sky dominant"].
Output ONLY valid JSON, no markdown fences.
"""
    async with semaphore:
        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.0-flash",
                contents=[
                    genai_types.Part(text=prompt),
                    genai_types.Part(
                        file_data=genai_types.FileData(
                            mime_type=mime_type,
                            file_uri=url,
                        )
                    ),
                ],
                config=genai_types.GenerateContentConfig(
                    max_output_tokens=512,
                    temperature=0.1,
                ),
            )
            return response.text[:_MAX_CONTENT_CHARS]
        except Exception as exc:
            logger.warning("Image description failed for %s: %s", url, exc)
            return None


async def stage_3_fetch_content(
    typed_sources: list[TypedSource],
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
    processor_name: str | None = None,
    fast_path: bool = False,
) -> list[FetchedContent]:
    """Fetch content from each source, routing by type.

    Fast path skips PDFs and images (which are slower to process) to hit the
    35-second first-manifest target.

    Args:
        typed_sources: Sources from Stage 2 with type annotations.
        client: Shared google-genai async client (needed for image description).
        semaphore: Rate-limit gate.
        processor_name: Document AI processor resource name for PDF OCR.
        fast_path: If True, skip pdf and image sources.

    Returns:
        List of ``FetchedContent`` for successfully fetched sources.
    """

    async def _fetch_one(src: TypedSource) -> FetchedContent | None:
        if fast_path and src.source_type in ("pdf", "image"):
            return None

        content: str | None = None

        if src.source_type == "wikipedia":
            content = await _fetch_wikipedia_text(src.url)
        elif src.source_type == "image":
            content = await _fetch_image_description(src.url, client, semaphore)
        elif src.source_type == "pdf":
            content = await _fetch_pdf_text(src.url, processor_name)
        else:
            # webpage, dataset, unknown — httpx scrape
            content = await _fetch_webpage_text(src.url)

        if not content or len(content.strip()) < 50:
            logger.debug("Stage 3: no usable content from %s", src.url)
            return None

        return FetchedContent(
            url=src.url,
            title=src.title,
            source_type=src.source_type,
            content=content[:_MAX_CONTENT_CHARS],
        )

    results = await asyncio.gather(*[_fetch_one(src) for src in typed_sources])
    fetched = [r for r in results if r is not None]
    logger.debug("Stage 3: fetched content from %d/%d sources", len(fetched), len(typed_sources))
    return fetched


# ---------------------------------------------------------------------------
# Stage 4 — Dual Evaluation
# ---------------------------------------------------------------------------


async def _quality_evaluate(
    fetched: FetchedContent,
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
    era: str = "",
) -> tuple[int, int, int, str]:
    """Call A: evaluate source quality independently of scene context.

    Args:
        fetched: Source content to evaluate.
        client: Shared google-genai async client.
        semaphore: Rate-limit gate.
        era: Required era/period for the scene (used for era_accuracy scoring).

    Returns:
        Tuple of (authority_score, detail_density_score, era_accuracy_score, reason).
        Returns (0, 0, 0, reason) on failure.
    """
    era_context = f"\nREQUIRED ERA FOR THIS SCENE: {era}\nera_accuracy should score how well the source's era coverage matches this required era.\n" if era else ""

    prompt = f"""\
You are evaluating a historical source for visual research quality.
{era_context}
SOURCE CONTENT (first 3000 characters):
{fetched.content[:3000]}

Score this source on THREE dimensions (1–10 each):
1. authority      — Is this an institutional source, primary archive, peer-reviewed, or museum catalogue?
                    (10 = primary archive / museum; 5 = reputable secondary; 1 = tourist blog / opinion)
2. detail_density — Does it contain SPECIFIC visual language? (materials, colours, architectural details)
                    (10 = rich descriptive detail; 5 = some specifics; 1 = only generic overview)
3. era_accuracy   — Is this source contemporary to or authoritative about the depicted historical period?
                    (10 = period-accurate primary source; 5 = academic secondary; 1 = anachronistic)

REJECT threshold: ANY score below 5 means reject the source entirely.

Output ONLY a JSON object:
{{"authority": N, "detail_density": N, "era_accuracy": N, "reason": "one sentence"}}
"""
    async with semaphore:
        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    max_output_tokens=128,
                    temperature=0.1,
                ),
            )
            data = _parse_json_object(response.text)
            return (
                int(data.get("authority", 0)),
                int(data.get("detail_density", 0)),
                int(data.get("era_accuracy", 0)),
                str(data.get("reason", "")),
            )
        except Exception as exc:
            logger.debug("Quality eval failed for %s: %s", fetched.url, exc)
            return 0, 0, 0, f"Evaluation error: {exc}"


async def _relevance_evaluate(
    fetched: FetchedContent,
    scene_brief: dict[str, Any],
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
) -> tuple[int, list[str], str]:
    """Call B: evaluate relevance against the specific scene brief.

    Args:
        fetched: Source that passed quality evaluation.
        scene_brief: Serialised SceneBrief dict.
        client: Shared google-genai async client.
        semaphore: Rate-limit gate.

    Returns:
        Tuple of (relevance_score, relevant_passages, reason).
    """
    scene_summary = (
        f"Era: {scene_brief.get('era', '')}\n"
        f"Location: {scene_brief.get('location', '')}\n"
        f"Key entities: {', '.join(scene_brief.get('key_entities', []))}\n"
        f"Cinematic hook: {scene_brief.get('cinematic_hook', '')}\n"
        f"Document excerpt: {scene_brief.get('document_excerpt', '')[:300]}"
    )

    prompt = f"""\
You are checking whether a historical source is relevant to a specific documentary scene.

SCENE BRIEF:
{scene_summary}

SOURCE CONTENT (first 3000 characters):
{fetched.content[:3000]}

Task:
1. Score relevance 1–10: how directly does this source provide visual reference for THIS scene?
   (10 = directly depicts this scene's era, location, and entities; 1 = unrelated era or subject)
2. Extract 1–5 VERBATIM QUOTES from the source that are most visually useful for this scene.
   Only exact quotes — do NOT paraphrase or summarise.
   Reject threshold: relevance_score < 7 means do not proceed to extraction.

Output ONLY a JSON object:
{{"relevance_score": N, "relevant_passages": ["verbatim quote 1", ...], "reason": "one sentence", "accept": true|false}}
"""
    async with semaphore:
        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
                config=genai_types.GenerateContentConfig(
                    max_output_tokens=512,
                    temperature=0.1,
                ),
            )
            data = _parse_json_object(response.text)
            return (
                int(data.get("relevance_score", 0)),
                list(data.get("relevant_passages", [])),
                str(data.get("reason", "")),
            )
        except Exception as exc:
            logger.debug("Relevance eval failed for %s: %s", fetched.url, exc)
            return 0, [], f"Evaluation error: {exc}"


async def stage_4_dual_evaluate(
    fetched_sources: list[FetchedContent],
    scene_brief: dict[str, Any],
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
    fast_path: bool = False,
    early_exit_count: int = 2,
) -> tuple[list[EvaluatedSource], list[EvaluatedSource]]:
    """Evaluate each fetched source with quality then relevance checks.

    Quality evaluation (Call A) runs in parallel for all sources.  Only
    sources that pass Call A proceed to relevance evaluation (Call B).

    Fast path early exit: if ``fast_path`` is True and at least
    ``early_exit_count`` sources have passed both evaluations, evaluation
    stops immediately — remaining sources are marked rejected with a note.

    Args:
        fetched_sources: Fetched content from Stage 3.
        scene_brief: Serialised SceneBrief dict.
        client: Shared google-genai async client.
        semaphore: Rate-limit gate.
        fast_path: Whether to apply early exit after 2 accepted sources.
        early_exit_count: Number of accepted sources required to trigger early exit.

    Returns:
        Tuple of (accepted_sources, rejected_sources).
    """
    accepted: list[EvaluatedSource] = []
    rejected: list[EvaluatedSource] = []

    # ---------- Call A: Quality evaluation (parallel) ----------
    era = scene_brief.get("era", "")
    quality_tasks = [_quality_evaluate(src, client, semaphore, era=era) for src in fetched_sources]
    quality_results = await asyncio.gather(*quality_tasks)

    quality_passed: list[tuple[FetchedContent, int, int, int, str]] = []
    for fetched, (auth, detail, era, reason) in zip(fetched_sources, quality_results):
        passed = auth >= 5 and detail >= 5 and era >= 5
        if not passed:
            rejected.append(EvaluatedSource(
                url=fetched.url,
                title=fetched.title,
                source_type=fetched.source_type,
                accepted=False,
                authority_score=auth,
                detail_density_score=detail,
                era_accuracy_score=era,
                relevance_score=0,
                reason=reason or "Failed quality evaluation (score below threshold)",
                relevant_passages=[],
            ))
        else:
            quality_passed.append((fetched, auth, detail, era, reason))

    # ---------- Call B: Relevance evaluation (sequential for early-exit support) ----------
    for fetched, auth, detail, era, quality_reason in quality_passed:
        if fast_path and len(accepted) >= early_exit_count:
            # Early exit: mark remaining as skipped
            rejected.append(EvaluatedSource(
                url=fetched.url,
                title=fetched.title,
                source_type=fetched.source_type,
                accepted=False,
                authority_score=auth,
                detail_density_score=detail,
                era_accuracy_score=era,
                relevance_score=0,
                reason="Skipped: fast-path early exit (sufficient sources already accepted)",
                relevant_passages=[],
            ))
            continue

        rel_score, passages, rel_reason = await _relevance_evaluate(
            fetched, scene_brief, client, semaphore
        )
        passed = rel_score >= 7

        evaluated = EvaluatedSource(
            url=fetched.url,
            title=fetched.title,
            source_type=fetched.source_type,
            accepted=passed,
            authority_score=auth,
            detail_density_score=detail,
            era_accuracy_score=era,
            relevance_score=rel_score,
            reason=rel_reason or quality_reason,
            relevant_passages=passages if passed else [],
        )
        if passed:
            accepted.append(evaluated)
        else:
            rejected.append(evaluated)

    logger.debug(
        "Stage 4: %d accepted, %d rejected for scene %s",
        len(accepted),
        len(rejected),
        scene_brief.get("scene_id"),
    )
    return accepted, rejected


# ---------------------------------------------------------------------------
# Stage 5 — Targeted Detail Extraction
# ---------------------------------------------------------------------------


async def stage_5_extract_details(
    accepted_sources: list[EvaluatedSource],
    scene_brief: dict[str, Any],
    client: google_genai.Client,
    semaphore: asyncio.Semaphore,
) -> list[VisualDetailFragment]:
    """Extract structured visual detail fields from each accepted source.

    Only ``relevant_passages`` (verbatim quotes from Stage 4 Call B) are
    sent to this stage — never the full source text.  This enforces zero
    information loss without context overload.

    Args:
        accepted_sources: Sources that passed both Stage 4 evaluations.
        scene_brief: Serialised SceneBrief dict for grounding context.
        client: Shared google-genai async client.
        semaphore: Rate-limit gate.

    Returns:
        List of ``VisualDetailFragment`` objects, one per accepted source.
    """

    async def _extract_one(src: EvaluatedSource) -> VisualDetailFragment | None:
        if not src.relevant_passages:
            return None

        passages_text = "\n\n".join(
            f'"{p}"' for p in src.relevant_passages
        )
        prompt = f"""\
You are extracting period-accurate visual details from archival source passages
to inform an Imagen 3 image generation prompt.

SCENE CONTEXT:
Era: {scene_brief.get('era', '')}
Location: {scene_brief.get('location', '')}
Mood: {scene_brief.get('mood', '')}
Cinematic hook: {scene_brief.get('cinematic_hook', '')}

RELEVANT PASSAGES FROM SOURCE (verbatim quotes only — your source of truth):
{passages_text}

Extract ONLY details that are explicitly supported by the passages above.
Do NOT invent, infer, or generalise beyond what is stated.

Output ONLY a JSON object with these fields (use short, specific phrases — not sentences):
{{
  "lighting":            ["specific lighting detail", ...],
  "materials":           ["specific material or texture", ...],
  "color_palette":       ["specific color name", ...],
  "architecture":        ["specific structural detail", ...],
  "clothing":            ["specific garment or textile", ...],
  "atmosphere":          ["specific atmospheric quality", ...],
  "era_markers":         ["period-specific element NOT found in modern settings", ...],
  "subjects":            ["person described by activity/clothing/posture, NOT physical appearance", ...],
  "compositional_notes": ["spatial arrangement, depth cues, foreground vs background details", ...]
}}
Omit any field for which there is NO evidence in the passages.
"""
        async with semaphore:
            try:
                response = await client.aio.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=prompt,
                    config=genai_types.GenerateContentConfig(
                        max_output_tokens=512,
                        temperature=0.1,
                    ),
                )
                data = _parse_json_object(response.text)
                return VisualDetailFragment(
                    source_url=src.url,
                    lighting=list(data.get("lighting", [])),
                    materials=list(data.get("materials", [])),
                    color_palette=list(data.get("color_palette", [])),
                    architecture=list(data.get("architecture", [])),
                    clothing=list(data.get("clothing", [])),
                    atmosphere=list(data.get("atmosphere", [])),
                    era_markers=list(data.get("era_markers", [])),
                    subjects=list(data.get("subjects", [])),
                    compositional_notes=list(data.get("compositional_notes", [])),
                )
            except Exception as exc:
                logger.warning("Stage 5 extraction failed for %s: %s", src.url, exc)
                return None

    results = await asyncio.gather(*[_extract_one(src) for src in accepted_sources])
    fragments = [r for r in results if r is not None]
    logger.debug(
        "Stage 5: extracted %d fragments for scene %s",
        len(fragments),
        scene_brief.get("scene_id"),
    )
    return fragments


# ---------------------------------------------------------------------------
# Stage 6 — Manifest Synthesis
# ---------------------------------------------------------------------------


def _merge_detail_fields(fragments: list[VisualDetailFragment]) -> MergedVisualDetail:
    """Merge and deduplicate visual detail fields from all fragments.

    Deduplication is case-insensitive exact match — no fuzzy matching to
    avoid silently collapsing distinct details.

    Args:
        fragments: Visual detail fragments from Stage 5.

    Returns:
        A ``MergedVisualDetail`` with deduplicated entries per field.
    """
    merged: dict[str, list[str]] = {
        "lighting": [], "materials": [], "color_palette": [],
        "architecture": [], "clothing": [], "atmosphere": [], "era_markers": [],
        "subjects": [], "compositional_notes": [],
    }
    seen: dict[str, set[str]] = {k: set() for k in merged}

    for frag in fragments:
        for field in merged:
            for item in getattr(frag, field, []):
                norm = item.lower().strip()
                if norm and norm not in seen[field]:
                    seen[field].add(norm)
                    merged[field].append(item)

    return MergedVisualDetail(**merged)


async def stage_6_synthesize_manifest(
    fragments: list[VisualDetailFragment],
    accepted_sources: list[EvaluatedSource],
    rejected_sources: list[EvaluatedSource],
    scene_brief: dict[str, Any],
    segment_id: str,
    client: google_genai.Client,
    visual_bible: str = "",
    narrative_role: str = "",
    frame_concepts: list[str] | None = None,
) -> VisualDetailManifest:
    """Synthesise all extracted fragments into a final VisualDetailManifest.

    Uses Gemini 2.0 Pro for superior synthesis quality — this call is the
    single most consequential step in Phase IV, as the enriched_prompt
    directly drives Imagen 3 generation.

    If ``fragments`` is empty (all sources rejected), returns a minimal
    manifest with an empty enriched_prompt — the Visual Director will fall
    back to the Script Agent's ``visual_descriptions``.

    Args:
        fragments: Visual detail fragments from Stage 5.
        accepted_sources: Accepted evaluated sources (for audit trail).
        rejected_sources: Rejected evaluated sources (for audit trail).
        scene_brief: Serialised SceneBrief dict.
        segment_id: Matching SegmentScript id.
        client: Shared google-genai async client.
        visual_bible: Imagen 3 style guide for the documentary.
        narrative_role: Scene role in narrative arc (opening, climax, etc.).
        frame_concepts: Four director-specified frame concepts from the
            storyboard.  When provided, frame prompts implement these
            concepts instead of using the default camera-angle variants.

    Returns:
        A ``VisualDetailManifest`` ready to write to Firestore.
    """
    merged = _merge_detail_fields(fragments)
    all_sources = accepted_sources + rejected_sources

    if not fragments:
        logger.warning(
            "Stage 6: no fragments for scene %s — returning empty manifest",
            scene_brief.get("scene_id"),
        )
        return VisualDetailManifest(
            scene_id=scene_brief.get("scene_id", ""),
            segment_id=segment_id,
            enriched_prompt="",
            detail_fields=merged,
            sources_accepted=0,
            sources_rejected=len(rejected_sources),
            reference_sources=all_sources,
            negative_prompt="",
        )

    # Serialize merged details for the prompt
    merged_dict = merged.model_dump()
    details_text = "\n".join(
        f"{field.replace('_', ' ').title()}: {', '.join(values)}"
        for field, values in merged_dict.items()
        if values
    )

    visual_bible_section = (
        f"GLOBAL VISUAL BIBLE (Imagen 3 style guide for this entire documentary):\n{visual_bible}\n\n"
        if visual_bible else ""
    )
    visual_bible_style_prefix = visual_bible.split(".")[0].strip() if visual_bible else "a cinematic historical documentary"

    prompt = f"""\
You are the visual director for an AI-generated historical documentary.

{visual_bible_section}SCENE BRIEF:
Title: {scene_brief.get('title', '')}
Era: {scene_brief.get('era', '')}
Location: {scene_brief.get('location', '')}
Key entities: {', '.join(scene_brief.get('key_entities', []))}
Mood: {scene_brief.get('mood', '')}
Cinematic hook: {scene_brief.get('cinematic_hook', '')}
Narrative role: {scene_brief.get('narrative_role', '')}
Document excerpt: {scene_brief.get('document_excerpt', '')[:300]}

PERIOD-ACCURATE VISUAL DETAILS (sourced from archival research):
{details_text}

Write a MASTER VISUAL PROMPT of 200-300 words that serves as the shared foundation \
for 4 cinematic frames of this scene.

This master prompt will be used for all four frames (wide establishing shot, medium \
shot, close-up detail, dramatic angle). It must be:
- Evocative but compositionally flexible (describes the scene's essence, not one fixed framing)
- Rich with period-accurate visual vocabulary from the sourced details above
- Strong on: lighting conditions, material textures, color palette, atmospheric quality
- Free of anachronisms — use the era_markers list as visual exclusion anchors

Open with: "In the style of {visual_bible_style_prefix}."
Include: the scene's specific location and era + all extracted lighting/materials/palette/architecture \
details + subject descriptions (people by occupation/posture/clothing only) + atmospheric qualities
End with era exclusion line: "Exclude from all frames: [comma-separated era_markers]."
- No bullet points, no headers — flowing prose only
- No modern elements whatsoever; no anachronisms
- Tone must match the scene mood: {scene_brief.get('mood', 'cinematic')}

Output ONLY the prompt text, no preamble.
"""

    # --- Generate subject-differentiated frame prompts (only needed frames) ---

    # When storyboard frame_concepts are provided, use all 4 frames with the
    # director's concepts.  Otherwise, determine frames from narrative role.
    use_storyboard_concepts = bool(frame_concepts and len(frame_concepts) >= 4)

    if use_storyboard_concepts:
        needed_frames = [0, 1, 2, 3]
    else:
        # Determine which frame indices this scene actually needs.
        # Opening and coda scenes get 1 frame; climax gets 3; others get 2.
        _STAGE6_FRAME_PLAN: dict[str, list[int]] = {
            "opening":       [0],
            "rising_action": [0, 1],
            "climax":        [0, 1, 3],
            "resolution":    [1, 3],
            "coda":          [3],
        }
        needed_frames = _STAGE6_FRAME_PLAN.get(narrative_role, [0, 1])

    _FRAME_DESCRIPTIONS: dict[int, str] = {
        0: "FRAME 0 — ENVIRONMENT: Architectural environment ONLY. No human figures. The space, its scale, textures, atmosphere. Include the specific era and location (e.g. \"circa {era}\").",
        1: "FRAME 1 — HUMAN ACTIVITY: People in this space at medium distance. Workers, citizens, officials, or soldiers in period dress. Human activity as primary subject, environment as background.",
        2: "FRAME 2 — MATERIAL DETAIL: Extreme close-up of ONE specific object or surface — carved stone, worn tool, textile, architectural ornament. The material IS the subject. No context scene.",
        3: "FRAME 3 — ATMOSPHERE: Dramatic light/shadow relationship. Interior/exterior threshold, light beam, shadow contrast, environmental scale. Atmosphere as subject.",
    }
    era = scene_brief.get("era", "historical period")

    if use_storyboard_concepts:
        # Use storyboard frame_concepts instead of generic frame descriptions
        frame_descriptions_text = "\n\n".join(
            f"Frame {i}: {frame_concepts[i]}"
            for i in range(4)
        )
        frame_concept_preamble = (
            "The documentary director has specified these 4 distinct frame concepts for this scene.\n"
            "Generate frame_prompts that implement each concept, enriched with the archival visual\n"
            "details you just compiled. Each frame_prompt should be 80-120 words and describe a\n"
            "different subject/moment from the scene:\n\n"
        )
    else:
        frame_descriptions_text = "\n\n".join(
            _FRAME_DESCRIPTIONS[i].replace("{era}", era) for i in needed_frames
        )
        frame_concept_preamble = ""

    frame_count = len(needed_frames)

    frame_word_range = "80–120" if use_storyboard_concepts else "60–90"

    frame_prompts_prompt = f"""\
You are the visual director for an AI-generated historical documentary.

{visual_bible_section}SCENE BRIEF:
Title: {scene_brief.get('title', '')}
Era: {scene_brief.get('era', '')}
Location: {scene_brief.get('location', '')}
Key entities: {', '.join(scene_brief.get('key_entities', []))}
Mood: {scene_brief.get('mood', '')}
Cinematic hook: {scene_brief.get('cinematic_hook', '')}

PERIOD-ACCURATE VISUAL DETAILS (sourced from archival research):
{details_text}

Write {frame_count} Imagen 3 prompt(s) for this scene. Each must describe a DIFFERENT SUBJECT.

{frame_concept_preamble}{frame_descriptions_text}

Each prompt must:
- Start with "Cinematic still photograph."
- Be {frame_word_range} words
- Contain the explicit era/century (e.g. "{scene_brief.get('era', 'historical era')}")
- Use period-specific vocabulary from the extracted details above

Output ONLY a JSON array of exactly {frame_count} string(s), in the order listed above:
{json.dumps(['Frame ' + str(i) + ' text...' for i in needed_frames])}
"""

    frame_prompts: list[str] = ["", "", "", ""]
    try:
        fp_response = await client.aio.models.generate_content(
            model="gemini-2.0-flash",
            contents=frame_prompts_prompt,
            config=genai_types.GenerateContentConfig(
                max_output_tokens=1024,
                temperature=0.7,
            ),
        )
        fp_text = fp_response.text.strip()
        # Strip markdown fences if present
        if fp_text.startswith("```"):
            fp_text = fp_text.split("\n", 1)[-1]
        if fp_text.endswith("```"):
            fp_text = fp_text.rsplit("```", 1)[0]
        parsed_fps = json.loads(fp_text.strip())
        if isinstance(parsed_fps, list) and len(parsed_fps) == frame_count and all(isinstance(s, str) for s in parsed_fps):
            # Map prompts back to their absolute frame indices (0-3) for direct
            # index access by Phase V: frame_prompts[frame_idx]
            indexed: list[str] = ["", "", "", ""]
            for list_pos, frame_idx in enumerate(needed_frames):
                if frame_idx < 4:
                    indexed[frame_idx] = parsed_fps[list_pos]
            frame_prompts = indexed
            logger.debug(
                "Stage 6 frame_prompts: generated %d/%d frames for scene %s (role=%r): indices %s",
                frame_count, 4, scene_brief.get("scene_id"), narrative_role, needed_frames,
            )
        else:
            logger.warning("Stage 6 frame_prompts parse: unexpected format for scene %s", scene_brief.get("scene_id"))
    except Exception as exc:
        logger.warning("Stage 6 frame_prompts generation failed for scene %s: %s", scene_brief.get("scene_id"), exc)

    # --- Generate master enriched_prompt (used as fallback when frame_prompts is empty) ---
    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.0-pro",
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                max_output_tokens=1024,
                temperature=0.2,
            ),
        )
        enriched_prompt = response.text.strip()
    except Exception as exc:
        logger.warning("Stage 6 synthesis failed for scene %s: %s", scene_brief.get("scene_id"), exc)
        enriched_prompt = ""

    # Build negative prompt from era_markers
    era_markers_list = merged.era_markers if merged else []
    negative_prompt = ", ".join(era_markers_list) if era_markers_list else ""

    return VisualDetailManifest(
        scene_id=scene_brief.get("scene_id", ""),
        segment_id=segment_id,
        enriched_prompt=enriched_prompt,
        frame_prompts=frame_prompts,
        detail_fields=merged,
        sources_accepted=len(accepted_sources),
        sources_rejected=len(rejected_sources),
        reference_sources=all_sources,
        negative_prompt=negative_prompt,
    )
