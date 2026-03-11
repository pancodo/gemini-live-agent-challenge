# Cinematic Visual Storytelling Redesign
**Date:** 2026-03-11
**Status:** Planning
**Author:** Efe
**Scope:** Phase IV–V visual pipeline (Phases I–III unchanged)

---

## The Problem We're Solving

### Problem 1: Visual Monotony (Critical)
The current Phase IV treats every scene as **fully isolated**. For a Colosseum document with 4 scenes, all 4 scene pipelines independently discover sources, and all of them will naturally find the same canonical Colosseum reference images. Result: 16 images that all look like variations of the same Colosseum shot.

A real documentary director never lets two consecutive scenes show the same subject from the same angle. Scene 1 is the exterior establishing shot. Scene 2 is inside the arena, workers laying sand. Scene 3 is the Emperor's box, ornate ceremony. Scene 4 is the hypogeum — the underground mechanics. Completely different visual territory per scene.

**There is no mechanism today that prevents all scenes from visually repeating each other.**

### Problem 2: Too Expensive, Not Targeted
Current per-scene call count (deep path):
- Stage 0: 1 Gemini call (query generation)
- Stage 1: 1 grounding call (source discovery, up to 10 URLs)
- Stage 2: 1–10 Gemini calls (type detection per URL)
- Stage 3: 1–10 httpx fetches + possible Doc AI calls
- Stage 4: 2 Gemini calls per source × 10 sources = 20 calls
- Stage 5: 1 Gemini call per accepted source = up to 10 calls
- Stage 6: 1 Gemini Pro call (manifest synthesis)

**~44 Gemini calls per scene × 4 scenes = ~176 calls for Phase IV alone.**

Most of these evaluate mediocre sources. 3 excellent, targeted sources produce a better manifest than 10 random ones.

### Problem 3: 4 Frames Are Not 4 Scenes
Currently each scene generates 4 Imagen 3 frames with simple composition modifiers: `wide shot`, `medium shot`, `close-up`, `dramatic`. All four frames use the **same base enriched_prompt** — only the camera angle changes. This produces 4 virtually identical images of the same subject.

`frame_prompts` in `VisualDetailManifest` exists but is not consistently used by the Visual Director.

### Problem 4: No Narrative Arc in Visuals
The documentary structure has a dramatic arc (`opening → rising_action → climax → resolution → coda`) defined at the scene level, but this arc is **not reflected in the visual choices**. An `opening` scene should feel different from a `climax` scene not just in narration but in color temperature, composition style, and subject framing.

---

## The Solution: Narrative-First Visual Planning

### Core Principle
**Visual planning must happen before visual research.**

A single "Narrative Visual Planner" agent reads all scenes at once and assigns each scene a unique, non-overlapping visual territory — specifying the exact subject, perspective, mood, what to avoid — before any research begins. The research agents then execute targeted searches for their assigned territory, not generic scene-title searches.

This mirrors how real documentary directors work: the director's treatment comes before the archive researcher's trip to the library.

---

## New 7-Agent Architecture

```
Phase 4.0  [Sequential, ~8s]
───────────────────────────
Agent 1: NarrativeVisualPlanner
  Input:  scene_briefs (all), script (all), visual_bible
  Output: visual_storyboard — unique visual territory per scene
          ├─ primary_subject (unique across ALL scenes)
          ├─ perspective + camera_position
          ├─ time_of_day + lighting_condition
          ├─ color_palette (3-4 dominant colors)
          ├─ avoid_list (prevents cross-scene repetition)
          ├─ 3 targeted_search_queries (specific, archival quality)
          ├─ 4 distinct frame_concepts (NOT just camera angle variants)
          └─ narrative_visual_bridge (how this scene transitions to next)

Phase 4.1  [Concurrent, 6 agents, ~20s]
────────────────────────────────────────
Agents 2–7: VisualResearchAgent (one per scene, max 6 concurrent)
  Input:  storyboard[scene_id] (pre-planned queries)
  Flow:
    Step A: Execute 3 targeted grounding searches (from storyboard, no query generation)
    Step B: Fetch content from top 3 sources per search (httpx only — no Doc AI)
    Step C: Quick single-call relevance evaluation per source (not dual 2-call eval)
    Step D: Synthesize manifest from accepted sources + storyboard frame_concepts
  Output: VisualDetailManifest with 4 distinct frame_prompts

Phase 4.2  [Inline after each scene, concurrent]
──────────────────────────────────────────────────
VisualDirectorOrchestrator (unchanged structure, improved prompt strategy)
  - Uses manifest.frame_prompts[i] as primary (not enriched_prompt + modifier)
  - Each of 4 frames tells a different MOMENT of the scene's story
  - Veo 2 only triggered for scenes with narrative_role = "climax"
```

---

## Detailed Agent Specifications

### Agent 1: NarrativeVisualPlanner

**File:** `backend/agent_orchestrator/agents/narrative_visual_planner.py`
**Model:** `gemini-2.0-pro` (1 call total)
**Type:** Direct `client.aio.models.generate_content` — no ADK sub-agents

#### What it does
Makes a single structured Gemini Pro call with all scene briefs + script + visual bible. The prompt instructs the model to think like a documentary director writing a shot list — ensuring each scene tells a *different* visual story from the same document.

#### Output: `VisualStoryboard`

```python
class SceneVisualPlan(BaseModel):
    scene_id: str
    primary_subject: str          # The ONE thing this scene is ABOUT visually
    perspective: str              # Camera position/angle philosophy
    time_of_day: str              # Lighting context: "dawn mist", "harsh noon"
    color_palette: list[str]      # 3-4 dominant color descriptors
    avoid_list: list[str]         # Things appearing in other scenes — DO NOT repeat
    targeted_searches: list[str]  # 3 highly specific archival search queries
    frame_concepts: list[str]     # 4 distinct moments/subjects (not camera variants)
    narrative_bridge: str         # "Dissolve to [scene+1 subject]" — continuity note

class VisualStoryboard(BaseModel):
    session_id: str
    scenes: dict[str, SceneVisualPlan]   # keyed by scene_id
    global_palette: str                   # Visual bible summary (keeps consistency)
    color_temperature_arc: str            # e.g. "warm → cool → warm" across scenes
```

#### Prompt Engineering (key excerpt)

```
You are the documentary director for this film. Your job is to write a shot list
that ensures every scene shows something DIFFERENT from the document.

RULE 1: No two scenes may show the same subject from the same perspective.
RULE 2: If scene_1 shows the exterior of X, scene_2 MUST show the interior.
RULE 3: Each scene should reveal a NEW dimension of the historical story.
RULE 4: The avoid_list for each scene MUST reference what the adjacent scenes show.
RULE 5: Write search queries that would find ARCHIVAL MUSEUM SOURCES, not tourist photos.

For each scene, assign:
- A primary_subject that ONLY this scene will depict
- 3 targeted_searches that a museum archivist would use
- 4 frame_concepts where each frame shows a DIFFERENT MOMENT or SUBJECT within the scene
  (not just different camera angles of the same thing)
```

#### Example output for Colosseum document

```json
{
  "scene_0": {
    "primary_subject": "Roman construction workers placing travertine blocks, 70–80 AD",
    "perspective": "Ground-level looking upward at workers on wooden scaffolding",
    "time_of_day": "Midday Mediterranean sun, sharp shadows on stone",
    "color_palette": ["warm ochre", "stone grey", "terracotta dust", "linen white"],
    "avoid_list": ["completed Colosseum exterior", "crowd scenes", "gladiatorial combat"],
    "targeted_searches": [
      "Roman opus caementicium concrete construction techniques 1st century archaeological evidence",
      "ancient Roman scaffolding wooden centering arch construction Flavian amphitheater",
      "travertine limestone quarrying Tivoli Roman imperial period laborers depiction"
    ],
    "frame_concepts": [
      "Stone blocks suspended from pulley ropes, workers guiding them into mortar — dawn light",
      "Close-up: Roman mason's hands pressing concrete into wooden form, tools scattered",
      "Wide panorama: half-built amphitheater ring, 10,000 workers visible across site",
      "Architect holding papyrus plans, comparing to rising arch — administrative moment"
    ],
    "narrative_bridge": "Dissolve from raw construction to completed arena filled with sand (scene_1)"
  },
  "scene_1": {
    "primary_subject": "Arena floor preparation and gladiator arrival rituals, 80–100 AD",
    "perspective": "Interior arena level, looking across sand floor toward seating tiers",
    "time_of_day": "Early morning, before games begin, long shadows across sand",
    "color_palette": ["warm sand gold", "deep shadow brown", "imperial purple accent", "dried blood rust"],
    "avoid_list": ["construction workers", "exterior architecture", "completed marble facade"],
    "targeted_searches": [
      "Roman gladiator arena sand preparation ritual ancient sources Suetonius Juvenal",
      "Colosseum hypogeum underground chambers animal cages elevator mechanisms archaeological",
      "Roman gladiatorial equipment lorica segmentata helmet type archaeological finds Pompeii"
    ],
    ...
  }
}
```

---

### Agents 2–7: VisualResearchAgent (per scene)

**File:** `backend/agent_orchestrator/agents/visual_research_orchestrator.py` (modified)
**Model:** `gemini-2.0-flash` (3 grounding calls + 1–3 evaluation calls + 1 synthesis call per scene)

#### Streamlined Stage Pipeline

```
OLD:  Stage 0 → 1 → 2 → 3 → 4(dual) → 5 → 6  (~44 calls)
NEW:  Step A  → B → C → D             (~8 calls)
```

**Step A: Execute Pre-planned Searches** (replaces Stages 0–2)
- Use `targeted_searches` from `VisualStoryboard` directly — no query generation step
- 3 grounding calls concurrently
- Collect top 3 URLs per search = max 9 sources total (de-duplicate → ~5–7 unique)
- Skip type detection: classify by URL domain heuristic (`.wikipedia.org` → wikipedia, `.edu`/`.museum` → academic, `.pdf` in URL → pdf, else webpage)

**Step B: Fetch Content** (same as Stage 3, but capped)
- Max 5 sources (highest quality by domain authority heuristic)
- Only fetch text (skip PDF Document AI — plain httpx for PDFs too)
- Timeout: 8 seconds per fetch
- Cap content at 4,000 characters (was 8,000)

**Step C: Single-call Evaluation** (replaces Stage 4 dual-eval)
- One Gemini 2.0 Flash call evaluates ALL fetched sources at once
- Returns: `[{url, accepted: bool, relevance: 1-10, visual_detail_density: 1-10, key_excerpts: [str]}]`
- No separate quality call — combined into one prompt
- Accept sources where `relevance ≥ 7` AND `visual_detail_density ≥ 6`

**Step D: Manifest Synthesis with Frame Concepts** (replaces Stages 5–6)
- One Gemini Pro call (was two: extract → synthesize)
- Input: accepted source excerpts + `scene.frame_concepts` from storyboard
- Output: 4 `frame_prompts` that implement the storyboard's frame_concepts but enriched with archival detail
- Each frame_prompt is 80–120 words, completely different subject from the others

#### Call count per scene: 3 (search) + 5 (fetch, async) + 1 (evaluate) + 1 (synthesize) = **10 calls**
#### Total for 4 scenes: ~40 calls (was ~176) — **77% reduction**

---

### Visual Director: Differentiated Frame Generation

**File:** `backend/agent_orchestrator/agents/visual_director_orchestrator.py` (modified)

#### Frame Generation Strategy

Each scene generates 4 frames. Each frame is a **different moment or subject**, not a camera variant of the same subject:

```python
# OLD approach — same subject, different camera modifier
frame_0_prompt = enriched_prompt + ", wide establishing shot"
frame_1_prompt = enriched_prompt + ", medium shot"
frame_2_prompt = enriched_prompt + ", close-up detail"
frame_3_prompt = enriched_prompt + ", dramatic atmospheric"

# NEW approach — different subject per frame from storyboard
frame_0_prompt = manifest.frame_prompts[0]  # Frame concept 0: unique subject
frame_1_prompt = manifest.frame_prompts[1]  # Frame concept 1: unique subject
frame_2_prompt = manifest.frame_prompts[2]  # Frame concept 2: unique subject
frame_3_prompt = manifest.frame_prompts[3]  # Frame concept 3: unique subject
```

#### Narrative Arc-Driven Styling

```python
NARRATIVE_ROLE_STYLES = {
    "opening": {
        "prefix": "Golden hour establishing shot, warm Renaissance palette,",
        "suffix": ", hopeful atmosphere, wide depth of field",
        "veo2": False,
    },
    "rising_action": {
        "prefix": "Dynamic composition, directional light from one side,",
        "suffix": ", sense of movement and activity",
        "veo2": False,
    },
    "climax": {
        "prefix": "High contrast chiaroscuro lighting, dramatic tension,",
        "suffix": ", peak dramatic moment, shallow depth of field on subject",
        "veo2": True,   # Climax scenes get Veo 2 video
    },
    "resolution": {
        "prefix": "Soft diffused light, calm composition, balanced symmetry,",
        "suffix": ", sense of conclusion and weight",
        "veo2": False,
    },
    "coda": {
        "prefix": "Long shadows, contemplative framing, historical distance,",
        "suffix": ", melancholic atmosphere, wide empty spaces",
        "veo2": False,
    },
}
```

This means only `climax` scenes trigger Veo 2 — **massive cost saving** (Veo 2 is expensive and slow).

---

## Data Flow Changes

### Session State Additions

```
session.state["visual_storyboard"]  →  dict[scene_id, SceneVisualPlan]  (Phase 4.0 output)
```

### Modified Flow

```
Phase III (script_agent_orchestrator)
  └── session.state["script"] = [SegmentScript, ...]

Phase 4.0 — NarrativeVisualPlanner (NEW, sequential, ~8s)
  ├── reads: scene_briefs, script, visual_bible
  └── writes: visual_storyboard

Phase 4.1 — VisualResearchOrchestrator (MODIFIED, 6 concurrent scenes)
  ├── reads: visual_storyboard[scene_id] (pre-planned queries + frame_concepts)
  └── writes: visual_research_manifest[scene_id] (4 distinct frame_prompts)

Phase 5 — VisualDirectorOrchestrator (MODIFIED, inline after each manifest)
  ├── reads: manifest.frame_prompts (4 unique subjects)
  ├── applies: narrative_role styling prefix/suffix
  └── writes: imageUrls to Firestore + emits segment_update(complete)
```

---

## Files to Create / Modify

### New Files

| File | Type | Description |
|------|------|-------------|
| `agents/narrative_visual_planner.py` | New | NarrativeVisualPlanner BaseAgent |
| `agents/storyboard_types.py` | New | SceneVisualPlan + VisualStoryboard Pydantic models |

### Modified Files

| File | Change | Impact |
|------|--------|--------|
| `agents/visual_research_orchestrator.py` | Replace Stages 0–2 with storyboard lookup; replace dual Stage 4 with single-call eval; merge Stages 5–6 into one synthesis call | 77% fewer Gemini calls |
| `agents/visual_director_orchestrator.py` | Use `frame_prompts[i]` directly; add `narrative_role` style prefix/suffix; limit Veo 2 to climax scenes only | Better visual differentiation, lower cost |
| `agents/pipeline.py` | Wire Phase 4.0 NarrativeVisualPlanner before VisualResearchOrchestrator | New sequential step |
| `agents/visual_detail_types.py` | Minor: ensure `frame_prompts` validation is strict (exactly 4 items) | Type safety |

### Unchanged Files

- `chunk_types.py` — no changes needed
- `script_types.py` — no changes needed
- `scene_research_agent.py` (Phase II) — unchanged
- `script_agent_orchestrator.py` (Phase III) — unchanged
- `visual_research_stages.py` — Stage 0–2 replaced, Stages 3/5/6 partially reused

---

## Implementation Sequence

### Step 1: Types (30 min)
Create `storyboard_types.py`:
```python
class SceneVisualPlan(BaseModel): ...
class VisualStoryboard(BaseModel): ...
```
Add strict validation for `frame_concepts` (must be exactly 4, each must be a unique subject).

### Step 2: NarrativeVisualPlanner (60 min)
Create `narrative_visual_planner.py`:
- Single Gemini Pro call with system + user prompt
- Parse JSON response into `VisualStoryboard`
- Write to `session.state["visual_storyboard"]`
- Emit `pipeline_phase(4.0, "VISUAL STORYBOARD")`
- Factory: `build_narrative_visual_planner(emitter)`

**Prompt engineering is the critical work here.** The prompt must:
1. Force uniqueness across scenes via the `avoid_list` mechanism
2. Generate archival-quality search queries (not tourist-photo queries)
3. Generate frame concepts that are genuinely different subjects

### Step 3: Streamlined VisualResearchOrchestrator (90 min)
Modify `visual_research_orchestrator.py`:
- Read `visual_storyboard` from session state
- Replace `stage_0_generate_queries` with storyboard lookup
- Replace `stage_1_discover_sources × stage_2_detect_types` with 3 targeted searches + domain-heuristic typing
- Keep `stage_3_fetch_content` (httpx only, 5 sources max, 4000 char cap)
- Replace dual `stage_4_dual_evaluate` with single-call batch evaluation
- Merge `stage_5_extract_details + stage_6_synthesize_manifest` into one synthesis call that uses storyboard's `frame_concepts`

### Step 4: Visual Director Improvements (45 min)
Modify `visual_director_orchestrator.py`:
- `_build_imagen_prompt` uses `manifest.frame_prompts[frame_idx]` as primary source
- Apply `NARRATIVE_ROLE_STYLES[narrative_role]` prefix + suffix to every frame prompt
- Gate Veo 2 trigger on `narrative_role == "climax"` (was: triggered by `veo2_scene` being non-null)

### Step 5: Pipeline Wiring (20 min)
Modify `pipeline.py`:
- Add `narrative_visual_planner_orch` before `visual_research_orch` in `build_new_pipeline()`
- These two run **sequentially** (planner → research), not in parallel

---

## Cost & Latency Estimates

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Gemini calls Phase IV (4 scenes) | ~176 | ~40 | −77% |
| Imagen 3 calls | 16 (4 scenes × 4 frames) | 16 | same |
| Veo 2 calls | 4 (one per scene) | 1 (climax only) | −75% |
| Phase IV latency (4 scenes) | ~90s | ~30s | −67% |
| Phase 4.0 latency (planner) | 0 (new step) | ~8s | +8s net |
| Visual diversity | All scenes same subject | All scenes unique subjects | ∞ improvement |

---

## Key Prompt: NarrativeVisualPlanner System Instruction

```
You are the visual director for a cinematic documentary. You have read a historical
document that has been divided into {N} scenes. Your job is to create a SHOT LIST
that ensures each scene is visually distinct from all others.

ABSOLUTE RULES:
1. No two scenes may depict the same primary subject. If scene_0 shows workers
   building X, scene_1 cannot also show workers — it must show a completely
   different aspect.
2. Each avoid_list must explicitly reference what is shown in adjacent scenes.
3. Search queries must be archival-grade: museum databases, academic archaeology,
   primary historical sources — NOT queries that would find tourist photography.
4. Frame concepts must be 4 genuinely different MOMENTS or SUBJECTS — not the
   same subject from 4 camera angles.
5. The color_temperature_arc across all scenes should create emotional progression
   (warm opening → neutral rising_action → cold/high-contrast climax → warm resolution).

You will return ONLY a valid JSON object matching the VisualStoryboard schema.
No markdown, no explanation.
```

---

## Visual Quality Improvement Examples

### Colosseum Document — Before vs After

**Before** (4 scenes, all research discovers same sources):
- Scene 0: Colosseum exterior, daylight — wide shot
- Scene 1: Colosseum exterior, daylight — medium shot
- Scene 2: Colosseum exterior, crowd visible — dramatic
- Scene 3: Colosseum ruins, modern — atmospheric

**After** (4 scenes, unique visual territories):
- Scene 0 (`opening`): Construction workers laying travertine, 70 AD, scaffolding, dawn light — warm ochre palette
- Scene 1 (`rising_action`): Arena floor, sand preparation, gladiators entering from hypogeum, morning shadows — sand gold + rust
- Scene 2 (`climax`): Emperor's pulvinus box, imperial ceremony, 50,000 crowd, overhead aerial — purple + gold chiaroscuro + **Veo 2 video**
- Scene 3 (`resolution`): Hypogeum underground chambers, animal cages, elevator mechanism — torch-lit, stone grey + shadow

---

## Open Questions

1. **Frame count**: Should `narrative_role` determine frame count (e.g., 6 frames for `climax`, 2 for `coda`)? Or keep 4 universal?
   → Recommend: keep 4 universal for Phase V simplicity, revisit later.

2. **Storyboard failure mode**: If NarrativeVisualPlanner fails or returns invalid JSON, should Phase 4.1 fall back to the old isolated search approach?
   → Yes, add `visual_storyboard_fallback` mode using old stage_0 query generation.

3. **Source language**: For non-English documents, should `targeted_searches` include queries in the source document's language?
   → Yes, the planner prompt should instruct this for non-Latin-script documents.

4. **6 vs 4 scenes**: The current doc caps at 4 scenes (development cost control). With the new streamlined pipeline, is it safe to raise this to 6?
   → Yes — 6 scenes × ~10 calls = 60 Gemini calls total, well within budget.

---

## Success Criteria

- [ ] All scenes in a multi-scene documentary show **different** primary subjects
- [ ] Zero instances of the same architectural element appearing in 2+ consecutive scenes as the primary subject
- [ ] Phase IV total cost ≤ 50 Gemini Flash calls for a 4-scene document
- [ ] Phase 4.0 (NarrativeVisualPlanner) completes in < 10 seconds
- [ ] Phase 4.1 (concurrent research) completes in < 25 seconds for 4 scenes
- [ ] `manifest.frame_prompts` always has exactly 4 entries, each 80–120 words
- [ ] `narrative_role == "climax"` → Veo 2 triggers; all others → Imagen 3 only
- [ ] Colosseum test document produces 4 visually distinct scene images on first run
