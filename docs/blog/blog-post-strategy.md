# Blog Post Strategy — +0.6 Bonus Points

## Competition Rules (Exact Requirements)

**Source:** Devpost official rules

| Requirement | Detail |
|---|---|
| Content type | Blog post, podcast, or video on any public platform |
| Topic | How the project was built using Google AI models and Google Cloud |
| Hashtag | `#GeminiLiveAgentChallenge` (on social media shares) |
| Disclosure | Must include language stating the content was created for the purposes of entering this hackathon |
| Visibility | Must be public (not unlisted) |
| Multiple submissions | Allowed — you can submit more than one piece per person |
| Points | Up to +0.6 added to final weighted score (range 1.0-6.0) |

**Disclosure wording to include in every post:**

> This post was written as part of my submission to the Gemini Live Agent Challenge hackathon, organized by Google LLC and administered by Devpost.

Place this at the bottom of the post, before or after the tags section.

---

## Platform Decision

### Recommendation: Dev.to (primary) + Medium (cross-post)

| Platform | Pros | Cons |
|---|---|---|
| **Dev.to** | Free, no paywall, instant publish, full markdown + code blocks, tags system, built-in audience of developers, indexed by Google within hours, no signup wall for readers | Smaller general audience than Medium |
| **Medium** | Larger general audience, Google indexes well, "publications" can amplify reach | Paywall friction for readers, markdown import is lossy, code block rendering is mediocre |
| **Personal blog** | Full control, SEO ownership | No built-in audience, judges may not visit |
| **Hashnode** | Developer-focused, custom domain, good SEO | Smaller community than Dev.to |

**Action plan:**
1. Publish on Dev.to first (canonical URL)
2. Cross-post to Medium with canonical URL pointing to Dev.to (avoids duplicate content penalty)
3. Share on Twitter/X and LinkedIn with `#GeminiLiveAgentChallenge` hashtag
4. Link both posts in the Devpost submission form

Dev.to wins because: judges click the link, see a clean technical post with syntax-highlighted code blocks, no paywall, loads fast. The rules say "any public platform" and list dev.to explicitly.

---

## Publish Timing

**Submission deadline:** March 16, 2026 at 5:00 PM PT

| Date | Action |
|---|---|
| **March 13 (Thu)** | Both posts drafted and reviewed by each other |
| **March 14 (Fri)** | Both posts published on Dev.to, cross-posted to Medium |
| **March 14 (Fri)** | Share on Twitter/X and LinkedIn with hashtag |
| **March 15 (Sat)** | Add blog post URLs to Devpost submission form |

**Why March 14, not March 16:**
- Posts need to be indexed and publicly accessible before judges review
- Buffer day for edits if something reads wrong
- Social media shares need time to propagate
- Writing under deadline pressure on March 16 produces worse content

---

## Blog Post 1: Berkay

### Title

**"Building a Real-Time Voice Historian with Gemini Live API: Interruption, Resumption, and Sub-300ms Latency"**

### Tags (Dev.to)

`#GeminiLiveAgentChallenge` `#gemini` `#webdev` `#googlecloud`

### Target length

1,800-2,200 words. Technical readers drop off past 2,500.

### Outline

#### 1. The Problem (150 words)

- We wanted a live AI historian persona the user can interrupt mid-sentence while a documentary plays
- Not a chatbot — a persona that narrates, listens, and answers simultaneously
- The hard constraint: < 300ms from user speech to historian stopping mid-word

#### 2. Why Gemini Live API (200 words)

- Persistent bidirectional WebSocket (not request-response)
- Server-side Voice Activity Detection (VAD) — no client-side silence detection needed
- Built-in interruption: `serverContent.interrupted = true` is server-detected
- Native audio output (no TTS round-trip) via `gemini-2.5-flash-native-audio-preview`
- Session resumption tokens for reconnection without context loss

**Code snippet:** The `BidiGenerateContentSetup` message structure showing the model config, system instruction (historian persona), and `realtimeInputConfig.automaticActivityDetection`.

#### 3. Architecture: The WebSocket Relay (300 words)

- Browser cannot connect directly to Gemini Live API (API key exposure)
- Solution: Node.js Cloud Run service (`live-relay`) that proxies WebSocket frames
- Diagram: `Browser <-> WebSocket <-> live-relay (Cloud Run) <-> WebSocket <-> Gemini Live API`
- The relay authenticates with Google, the browser authenticates with our backend
- Cloud Run WebSocket support: HTTP/2 upgrade, 3600s timeout, CPU always-allocated

**Code snippet:** Core relay logic — receiving a frame from browser, forwarding to Gemini, forwarding response back. Show the message routing (10-15 lines, not the full file).

#### 4. Browser Audio Pipeline (350 words)

- **Capture:** `getUserMedia` -> `AudioWorkletNode` -> 16-bit PCM at 16kHz, 1024-byte chunks
- **Why AudioWorklet, not ScriptProcessorNode:** AudioWorklet runs on a dedicated thread, no main-thread jank during animation-heavy documentary playback
- **Encoding:** Raw PCM bytes base64-encoded into `realtimeInput.mediaChunks`
- **Playback:** Incoming 24kHz PCM chunks queued in an `AudioBufferSourceNode` chain
- **The queue problem:** Chunks arrive faster than playback during burst responses. Solution: a playback queue that schedules each `AudioBufferSourceNode.start(nextStartTime)` precisely

**Code snippet:** The AudioWorklet processor (the `process()` method that converts Float32 to Int16 PCM).

#### 5. Handling Interruption (300 words)

- When the user speaks mid-narration, Gemini sends `serverContent.interrupted = true`
- The relay forwards this to the browser immediately
- Browser must: (1) stop current audio playback instantly, (2) clear the audio queue, (3) update UI state
- The latency budget: ~50ms network (relay) + ~20ms audio context stop + ~30ms UI update = < 300ms total
- Edge case: audio chunks in-flight when interruption arrives — the queue flush handles this
- After the user finishes speaking, Gemini responds with the historian's answer, then the documentary can optionally resume

**Code snippet:** The interruption handler — clearing the audio queue and resetting playback state (8-10 lines).

#### 6. Session Resumption (200 words)

- Gemini Live sessions have a 15-minute window (without compression)
- We use `contextWindowCompression.slidingWindow` for unlimited sessions
- On `goAway` or disconnect: store the `sessionResumptionUpdate.handle` token in Firestore
- On reconnect: send the token in the setup message — context is restored
- The token is valid for 2 hours — covers network blips, tab switches, browser refreshes

**Code snippet:** The resumption flow — storing token, detecting disconnect, reconnecting with token.

#### 7. What We Learned (200 words)

- The first message after WebSocket connect MUST be `BidiGenerateContentSetup` — sending content before `setupComplete` silently fails
- `gemini-2.0-flash-live-001` was shut down December 9, 2025 — use `gemini-2.5-flash-native-audio-preview-12-2025` or `gemini-live-2.5-flash-native-audio` (Vertex AI)
- PCM sample rate mismatch (sending 16kHz, receiving 24kHz) caused garbled audio for 2 hours before we caught it
- Cloud Run WebSocket services need `--cpu-always-allocated` or the container sleeps between frames

#### 8. Try It Yourself (100 words)

- Link to GitHub repo
- Link to live demo (if deployed)
- The three Cloud Run services and how to deploy them

#### Footer

Hackathon disclosure + `#GeminiLiveAgentChallenge`

---

## Blog Post 2: Efe

### Title

**"From Ottoman Manuscript to AI Documentary: Building a 7-Agent Research Pipeline with Google ADK"**

### Tags (Dev.to)

`#GeminiLiveAgentChallenge` `#gemini` `#python` `#googlecloud`

### Target length

2,000-2,500 words. This post covers more ground (5 pipeline phases).

### Outline

#### 1. The Problem (150 words)

- Upload a historical document in any language. Get a cinematic documentary in under 60 seconds.
- The pipeline must: OCR the document, understand it, research every claim, write a script, generate images and video — all automatically
- The challenge: orchestrating 7+ AI agents that share state, run in parallel where possible, and stream progress to the frontend in real time

#### 2. The Pipeline at a Glance (200 words)

- Diagram showing the 7-stage sequential pipeline:
  ```
  Document Analyzer → Scene Research (parallel) → Aggregator
  → Script Agent → Visual Planner → Visual Research → Visual Director
  ```
- Each stage is a custom `BaseAgent` subclass in Google ADK
- State flows between agents via `session.state["key"]` — ADK's built-in state sharing mechanism
- The entire pipeline streams SSE events to the frontend so the user sees research happening live

**Code snippet:** The `build_new_pipeline()` function from `pipeline.py` — the 15-line function that wires all 7 agents into a `SequentialAgent`. This is the most impressive "look how clean the orchestration is" moment.

#### 3. Phase I — Document Analysis (350 words)

- **OCR:** Google Document AI (`OCR_PROCESSOR`) handles 200+ languages — we tested with Ottoman Turkish manuscripts (Arabic script)
- **Semantic Chunking:** Rule-based Python splitter: page breaks (`\f`), heading detection, topic shift heuristics, 3200-char hard fallback. Not an LLM call — deterministic and fast.
- **Parallel Summarization:** `asyncio.gather` + `Semaphore(10)` sends every chunk to Gemini 2.0 Flash simultaneously. Rate-limited to respect API quotas.
- **Narrative Curator:** An ADK `Agent` (Gemini 2.0 Pro) that reads the full document map and selects 4-8 cinematically compelling scenes. Outputs structured `SceneBrief` objects and a "Visual Bible" — a style guide that every downstream visual prompt references.

**Code snippet:** The `SceneBrief` Pydantic model showing the structured output contract between agents.

**Key technical detail:** The Narrative Curator does not just summarize — it makes editorial decisions. It chooses which parts of a 50-page document become the 5-minute documentary. This is the creative intelligence of the system.

#### 4. Phase II — Parallel Scene Research with Google Search Grounding (350 words)

- **The ADK constraint that shaped the architecture:** `google_search` tool cannot be combined with other tools in the same agent. Each research agent is search-only.
- **Dynamic agent construction:** `SceneResearchOrchestrator` reads scene_briefs from state, builds N `Agent` objects (one per scene), wraps them in a `ParallelAgent`
- **The f-string trick:** ADK uses `{variable}` template syntax in instructions. In Python f-strings, this conflicts. Solution: double braces `{{scene_{i}_brief}}` in the f-string produce `{scene_0_brief}` in the output string, which ADK then resolves.
- **Chunk injection:** Each agent gets the raw document text for its scene's source chunks (fetched from Firestore via `asyncio.gather`), not just the summary. The research agent corroborates specific claims from the original text.
- **Source evaluation:** Each agent produces `accepted_sources` and `rejected_sources` with reasoning — the frontend displays this in the Agent Session Modal.

**Code snippet:** The dynamic agent construction loop showing `Agent(name=f"researcher_{i}", tools=[google_search], output_key=f"research_{i}")` inside a list comprehension.

**Key insight:** The research agents do not perform generic "tell me about the Ottoman Empire" searches. They research the specific claims made in each scene's source document chunks. This is grounded research, not hallucination.

#### 5. Phase III — Script Generation (200 words)

- Gemini 2.0 Pro reads scene briefs + aggregated research and produces `SegmentScript` objects
- Each segment: title, narration script (60-120 seconds spoken), 4 visual descriptions (Imagen 3 prompts), optional Veo 2 scene, mood, source citations
- Scripts are written to Firestore immediately — the frontend shows skeleton segment cards that fill in as each segment is generated
- SSE events stream progress: `segment_update(status="generating")` then `segment_update(status="ready")`

**Code snippet:** The `SegmentScript` Pydantic model.

#### 6. Phases IV-V — Visual Research and Generation (350 words)

- **Phase IV (Visual Research):** A 6-stage micro-pipeline per scene that uses Google Search Grounding to find period-accurate visual references, fetches and evaluates web sources, and produces `VisualDetailManifest` objects with enriched Imagen 3 prompts
- **Phase V (Visual Director):** Reads manifests and generates 4 Imagen 3 frames per scene concurrently. Progressive delivery: Scene 0's images are generated and streamed first (< 45 seconds from upload), remaining scenes generate in parallel.
- **Veo 2 integration:** Fire-and-forget async generation. Operations are long-running (~1-2 min). All Veo 2 polls run concurrently after Imagen 3 completes. Video URLs update Firestore and trigger SSE events.
- **The negative prompt system:** `era_markers` from visual research become Imagen 3 negative prompts — preventing modern elements from appearing in historical scenes.

**Code snippet:** The progressive delivery pattern — Scene 0 runs first, then `asyncio.gather(*remaining_scenes)`.

**Key technical detail:** Imagen 3 at 200 req/min allows 4 frames per scene across 6 scenes = 24 images in ~30 seconds. Veo 2 runs asynchronously and does not block the documentary from starting playback.

#### 7. SSE Streaming — Making the Pipeline Visible (200 words)

- Every agent emits structured SSE events via an `SSEEmitter` protocol
- Event types: `pipeline_phase`, `agent_status`, `agent_source_evaluation`, `segment_update`, `stats_update`
- The frontend renders these as the "Expedition Log" — a typewriter-style journal that narrates the research as it happens
- The 150ms drip buffer: SSE events from parallel agents arrive in bursts. The frontend buffers them and releases one every 150ms for a readable cadence.

**This turns waiting into content.** The user is watching AI research their document in real time. By the time the first segment is ready, they have already been engaged for 30-40 seconds.

#### 8. Lessons and Gotchas (200 words)

- ADK `ParallelAgent` provides no shared state during execution — each sub-agent must write to its own `output_key`
- `google_search` is the only tool that cannot coexist with other tools in the same agent — this fundamentally shapes your agent architecture
- Pydantic v2 `ConfigDict(arbitrary_types_allowed=True)` is required when your BaseAgent subclass has non-serializable fields (like the SSE emitter)
- `client.operations.get` for Veo 2 polling is sync-only in the Python GenAI SDK — must wrap with `loop.run_in_executor`
- Imagen 3 `negative_prompt` is supported and critical for historical accuracy
- Always parse LLM JSON output defensively: handle bare arrays, `{"segments":[...]}` envelopes, and markdown code fences

#### 9. The Full Stack (100 words)

- Table: all Google Cloud services used (Cloud Run, Firestore, GCS, Document AI, Vertex AI, Pub/Sub, Secret Manager)
- Link to GitHub repo
- Link to Terraform configs for automated deployment

#### Footer

Hackathon disclosure + `#GeminiLiveAgentChallenge`

---

## Social Media Amplification

Both team members share their posts on the same day.

### Twitter/X post template (Berkay)

```
I built a real-time voice historian you can interrupt mid-sentence using @GoogleAI's Gemini Live API.

Sub-300ms interruption latency. WebSocket relay on Cloud Run. PCM audio at 16kHz in, 24kHz out.

Here's how: [dev.to link]

#GeminiLiveAgentChallenge #BuildWithGemini
```

### Twitter/X post template (Efe)

```
We built an AI that turns any historical document into a cinematic documentary — 7 agents, parallel research, Imagen 3 + Veo 2 generation, all orchestrated with Google ADK.

Here's the full pipeline breakdown: [dev.to link]

#GeminiLiveAgentChallenge #BuildWithGemini
```

### LinkedIn post template (both)

Longer version (3-4 paragraphs) with the same core message, tagged with `#GeminiLiveAgentChallenge`. LinkedIn posts should emphasize the product value (turning documents into documentaries) more than the technical details.

---

## Checklist Before Publishing

- [ ] Hackathon disclosure present at the bottom of both posts
- [ ] `#GeminiLiveAgentChallenge` tag applied on Dev.to
- [ ] Code snippets are syntax-highlighted and accurate (pulled from actual codebase)
- [ ] Architecture diagrams are clear and match CLAUDE.md
- [ ] No API keys, secrets, or sensitive values in any code snippet
- [ ] Both posts cross-posted to Medium with canonical URL to Dev.to
- [ ] Both posts shared on Twitter/X with hashtag
- [ ] Both posts shared on LinkedIn with hashtag
- [ ] Blog post URLs added to Devpost submission form
- [ ] Posts are publicly accessible (not draft, not unlisted)

---

## What Makes These Posts Score Well

1. **Specificity over generality.** "16-bit PCM at 16kHz, 1024-byte chunks" beats "we used audio streaming." Judges are Google engineers — they know the APIs.

2. **Honest gotchas.** The PCM sample rate mismatch bug, the `run_in_executor` workaround for sync-only SDK methods, the f-string/ADK template conflict. These prove the software is real.

3. **Architecture diagrams.** Both posts need at least one visual. ASCII art in code blocks is fine for Dev.to. Mermaid diagrams render natively.

4. **Show the constraint-driven design.** The `google_search` tool isolation constraint, the ADK state sharing model, the Cloud Run WebSocket limitations — these are the interesting engineering stories. Do not just describe what was built; explain why it was built that way because of platform constraints.

5. **Progressive delivery narrative.** The posts should mirror the product: Efe's post should build tension (45 seconds to first playable segment) the same way the product does.
