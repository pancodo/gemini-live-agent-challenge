# Narrative Director Agent -- Design Document

**Date:** 2026-03-12
**Author:** AI Engineer
**Status:** Implementation ready
**File:** `backend/agent_orchestrator/agents/narrative_director.py`

---

## 1. The Strategic Argument

The hackathon's **Creative Storytellers** category (40% of total score) rewards:
> Fluid multimodal narrative where media types flow together naturally, not sequentially.

The current pipeline produces text and images **sequentially**: Script Agent writes narration (Phase III), then Visual Director generates images (Phase V). These are separate API calls, separate models, separate creative steps.

The **Narrative Director** makes ONE Gemini API call that produces **interleaved text and images in a single response**. The model writes a narration paragraph, then generates an illustration, then writes more narration, then generates another illustration -- all in one unified creative act.

This is not an incremental improvement. It is a **categorical difference** in how the system produces multimodal content:

| Aspect | Current Pipeline | With Narrative Director |
|---|---|---|
| Creative process | Sequential: write text, then generate images | Unified: text and images emerge together |
| API calls for 6 scenes | 1 text call + 24 image calls = 25 calls | 1 interleaved call = 1 call |
| Latency for first storyboard | ~45s (script + first Imagen 3 batch) | ~15-25s (single Gemini call) |
| Judging narrative | "We orchestrate multiple AI models" | "One AI creative director simultaneously writes and illustrates the documentary" |

The pitch to judges: **"A single Gemini model call acts as the documentary's Creative Director -- it writes the narration and draws the storyboard illustrations in the same breath. This is native multimodal creativity, not pipeline orchestration."**

---

## 2. Model Selection

**Model:** `gemini-2.0-flash-preview-image-generation`

This model supports `response_modalities=["TEXT", "IMAGE"]`, which instructs Gemini to produce a response containing both text Parts and inline image Parts interleaved naturally.

Key capabilities:
- Generates images inline within text responses (no separate Imagen API call)
- Images are returned as `inline_data` Parts with raw bytes
- The model decides where images fit naturally in its response flow
- Text quality remains high -- this is Gemini 2.0 Flash, not a downgraded vision model

**Why not replace the Script Agent entirely?**
- The Script Agent uses structured JSON output with precise field contracts (segment_id, scene_id, visual_descriptions array, veo2_scene, mood, sources). Downstream agents depend on this contract.
- The interleaved model produces flowing prose + images, not structured JSON. Parsing structured data from a response that interleaves binary image data is fragile.
- Both outputs serve different purposes: Script Agent = reliable data contract, Narrative Director = creative artifact + storyboard.

---

## 3. Pipeline Position

```
Phase I    document_analyzer        (OCR, chunking, scene briefs)
Phase II   scene_research           (parallel google_search)
           aggregator               (merge research)
Phase III  script_orch              (structured JSON segments)  <-- EXISTING
Phase III.5 fact_validator          (hallucination firewall)
Phase III-A narrative_director      (interleaved text+image)    <-- NEW
Phase 4.0  narrative_visual_planner (visual storyboard planning)
Phase IV   visual_research_orch     (6-stage visual research)
Phase V    visual_director_orch     (Imagen 3 + Veo 2)
```

The Narrative Director runs AFTER the Script Agent and Fact Validator, so it can reference the validated script as a foundation. It runs BEFORE Phase IV/V, so its storyboard images can serve as composition references for the final Imagen 3 generation.

### Integration with `pipeline.py`

In `_PHASE_AGENT_MAP`, add a new entry:

```python
_PHASE_AGENT_MAP: list[tuple[int | float, list[int]]] = [
    (1, [0]),       # Phase I:     document_analyzer
    (2, [1, 2]),    # Phase II:    scene_research + aggregator
    (3, [3]),       # Phase III:   script_orch
    (3.5, [4]),     # Phase III.5: fact_validator
    (3.7, [5]),     # Phase III-A: narrative_director         <-- NEW
    (4, [6]),       # Phase 4.0:   narrative_visual_planner
    (5, [7]),       # Phase IV:    visual_research_orch
    (6, [8]),       # Phase V:     visual_director_orch
]
```

In `build_new_pipeline()`, insert:

```python
narrative_director = build_narrative_director(
    emitter=emitter, rate_limiter=gemini_limiter,
)
```

And add it to the `sub_agents` list at index 5 (shifting all subsequent indices by 1).

---

## 4. The Gemini Prompt

The prompt casts Gemini as a **Creative Director** -- not a scriptwriter (that's the Script Agent's job) and not an image generator (that's Phase V's job). The Creative Director is the person who *sees the documentary as a unified whole*.

Key prompt design decisions:

1. **Persona:** "You do not merely write -- you SEE and COMPOSE simultaneously. Your mind works in images and words together, inseparable." This primes the model to interleave naturally rather than dumping all text then all images.

2. **Scene headers:** `**[SCENE: scene_id | title]**` markers let the parser split the response into per-scene segments. Without these, a long interleaved response would be unparseable.

3. **Image placement guidance:** "Generate 1-2 images PER SCENE directly inline with your text" -- explicit instruction to spread images through the response rather than clustering them.

4. **Visual Bible integration:** The existing visual_bible string (from Phase I) is injected directly, ensuring storyboard images match the documentary's established visual identity.

5. **Script reference:** The Script Agent's output is provided as a foundation. The Creative Director may refine prose but must not contradict facts. This ensures the storyboard narration is consistent with the structured segments.

6. **Painterly style for faces:** "NO photorealistic human faces -- use painterly style" avoids Imagen-style photorealism problems and produces more documentary-appropriate illustrations.

---

## 5. Response Parsing

The response from `generate_content` with `response_modalities=["TEXT", "IMAGE"]` contains a flat list of `Part` objects:

```
Part(text="**[SCENE: scene_0 | The Fall of Constantinople]**\n\nOn a May morning...")
Part(inline_data=InlineData(mime_type="image/png", data=b'\x89PNG...'))
Part(text="\n\nThe great chain across the Golden Horn...")
Part(inline_data=InlineData(mime_type="image/png", data=b'\x89PNG...'))
Part(text="\n\n---\n\n**[SCENE: scene_1 | The Siege Engines]**\n\n...")
...
```

The parser (`_parse_interleaved_response`) works as follows:

1. Flatten all Parts from all response candidates into a single list.
2. Scan text Parts for scene header regex: `\[SCENE:\s*(\S+)\s*\|\s*([^\]]+)\]`
3. On each scene header, flush the accumulated text+images for the previous scene.
4. Accumulate text Parts as narration and inline_data Parts as storyboard frames.
5. Track "last text before image" as an implicit caption for each image.
6. After the final Part, flush the last scene.

Edge cases handled:
- Multiple scene headers in a single text Part
- No scene headers at all (fallback: single segment)
- Base64-encoded image data (decoded to bytes)
- Missing inline_data (graceful skip)

---

## 6. SSE Event Design

### New SSE events

**segment_update with status="storyboarded"**

```json
{
  "type": "segment_update",
  "segmentId": "segment_0",
  "sceneId": "scene_0",
  "status": "storyboarded",
  "title": "The Fall of Constantinople",
  "imageUrls": [
    "gs://bucket/sessions/abc/storyboards/segment_0/frame_0.png",
    "gs://bucket/sessions/abc/storyboards/segment_0/frame_1.png"
  ]
}
```

This new status sits between "generating" (Phase III) and "ready" (Phase IV) in the segment lifecycle:

```
"generating"    --> Phase III:  skeleton card gets title/mood
"storyboarded"  --> Phase III-A: storyboard thumbnails appear on card
"ready"         --> Phase IV:   visual research manifest complete
"complete"      --> Phase V:    final Imagen 3 frames ready
```

### Frontend rendering

When the frontend receives `status: "storyboarded"`:
- The SegmentCard displays a filmstrip-style thumbnail row of storyboard images
- Images have a sketchy/draft visual treatment (CSS filter: sepia + slight blur)
- A "Storyboarded by Creative Director" label appears
- On hover, storyboard images expand to show the implicit caption

This gives the Expedition Log a dramatic new visual beat: the user watches storyboard sketches appear alongside narration text, then later sees them replaced by polished Imagen 3 frames.

### Agent card in Research Panel

The Narrative Director gets its own agent card in the Research Panel with states:

| State | Dot | Label |
|---|---|---|
| `queued` | Hollow, muted | "Preparing interleaved generation" |
| `searching` | Filled teal, pulse | "Creative Director composing 6 scenes with native text + image" |
| `evaluating` | Filled gold, shimmer | "Uploading 12 storyboard frames" |
| `done` | Filled green | "6 scenes narrated and illustrated in 18.3s" |

---

## 7. Firestore Schema Addition

```
/sessions/{sessionId}/storyboards/{segmentId}
  segmentId: string
  sceneId: string
  title: string
  narrationProse: string
  storyboardFrames: array<{
    frameIndex: number,
    gcsUrl: string,
    description: string
  }>
  createdAt: timestamp
```

The existing `/sessions/{sessionId}/segments/{segmentId}` documents gain:
- `storyboardUrls: array<string>` -- GCS URLs of storyboard images
- `status` transitions: `"pending" -> "generating" -> "storyboarded" -> "ready" -> "complete"`

---

## 8. Phase V Enhancement: Storyboard as Composition Reference

The VisualDirectorOrchestrator (Phase V) can use storyboard images as composition references when building Imagen 3 prompts. This is optional but powerful.

In `_build_imagen_prompt`, after constructing the text prompt:

```python
# If a storyboard image exists for this scene, include it as a
# composition reference in the Imagen 3 call
storyboard_urls = session_state.get("storyboard_urls", {})
scene_storyboards = storyboard_urls.get(scene_id, [])
if scene_storyboards:
    # Append to the prompt: "Composition reference: maintain the framing
    # and spatial arrangement shown in the storyboard, but render at
    # full cinematic quality with period-accurate details."
    pass  # Implementation detail for Phase V enhancement
```

This creates a virtuous loop: the Creative Director's interleaved images guide the final cinematic frames, producing more visually coherent documentaries.

---

## 9. Error Handling

The Narrative Director is designed to be **gracefully skippable**. If it fails:

1. The Script Agent's structured output (Phase III) is still the authoritative data contract.
2. Phase IV and V proceed normally using `visual_descriptions` from the script.
3. The frontend shows the segment lifecycle without the "storyboarded" step.
4. A warning is logged but the pipeline does not halt.

This is achieved by:
- Returning early on error (no exception propagation)
- Emitting `agent_status(status="error")` so the frontend shows the error state
- Not modifying any session state that downstream agents depend on
- Writing to separate Firestore collections (`storyboards/`) rather than overwriting `segments/`

---

## 10. Performance Characteristics

| Metric | Expected |
|---|---|
| Gemini interleaved call latency | 15-25s for 6 scenes with 12 images |
| GCS upload (12 storyboard images) | 3-5s concurrent |
| Total Phase III-A time | 20-30s |
| Image resolution | Model-dependent (typically 1024x1024) |
| Image format | PNG (inline_data default) |
| Token budget | ~4000 input tokens, ~8000 output tokens |

The Narrative Director adds 20-30 seconds to the total pipeline but provides:
- Storyboard images visible to the user 60+ seconds before final Imagen 3 frames
- A second narration perspective that enriches the documentary
- The single strongest argument for the Creative Storytellers judging criterion

---

## 11. The Judging Argument (Summary)

For the demo video and Devpost submission:

> "The AI Historian pipeline culminates in a moment that no other submission in this hackathon can match: a single Gemini API call where the model acts as our documentary's Creative Director. It writes the narration and generates storyboard illustrations *in the same response* -- not sequentially, not through separate API calls, but as a single unified creative act.
>
> This is native multimodal interleaving. One model. One call. Text and images flowing together as naturally as a human director sketching on a storyboard while dictating narration notes. The storyboard frames then guide our Imagen 3 cinematic generation, creating a creative feedback loop that begins in a single Gemini response."

This directly addresses the 40% Innovation & Multimodal UX criterion:
- **Breaking the text box paradigm**: A model that draws as it writes
- **Seamless interleaving of text and image**: Literal interleaving in one API call
- **Distinct AI persona**: The Creative Director persona with a specific creative voice
- **For Creative Storytellers specifically**: Fluid media interleaving in a coherent narrative
