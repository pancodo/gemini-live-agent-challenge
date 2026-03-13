# AI Historian -- Demo Video Script

**Duration:** 4:00 max (target 3:45 to leave buffer)
**Format:** Screencast with voiceover narration
**Resolution:** 3840x2160 (4K), export 1920x1080 60fps for YouTube
**Audio:** External microphone, recorded separately in Audacity, synced in post
**Upload:** YouTube, unlisted, "Not for Kids", English captions enabled

---

## Pre-Production

### Recording Setup

| Item | Recommendation |
|---|---|
| Screen recorder | Screen Studio (Mac) -- auto-zoom on clicks, smooth cursor, 4K export. Free alternative: OBS Studio |
| Microphone | External condenser or headset mic. Never laptop mic. Record in a quiet room |
| Browser | Chrome, maximized, 1920x1080 window. Clear bookmarks bar, close all tabs except the app |
| Notifications | Do Not Disturb ON. No Slack, no mail, no system popups |
| Font scaling | Browser zoom 110% so UI text is readable at 1080p YouTube compression |
| Mouse cursor | Default size, no custom cursors. Slow deliberate movements |
| Terminal | Hidden unless showing GCP console. No personal info visible |

### Pre-Recording Checklist

- [ ] Backend services deployed and healthy on Cloud Run
- [ ] Demo document PDF downloaded and ready on desktop
- [ ] Browser cache cleared, app loaded fresh at `/`
- [ ] Microphone level tested (peak at -6dB, no clipping)
- [ ] Screen Studio configured: zoom follows cursor, 1080p export, 60fps
- [ ] Two practice runs completed and timed
- [ ] GCP console tab pre-loaded with Cloud Run services page
- [ ] Architecture diagram image ready in a separate browser tab

### Document Selection

**Primary choice: Ottoman-era firman (imperial decree)**

Why this document wins the demo:

1. **Visual impact** -- Ornate calligraphy, tughra (sultan's monogram), gold illumination. Instantly communicates "historical artifact" to judges who have never seen one
2. **Non-Latin script** -- Arabic/Ottoman script proves multilingual OCR is real, not a gimmick. Judges cannot read it themselves, which makes the AI translation and research feel essential
3. **Rich research surface** -- A firman references a sultan, a date in the Islamic calendar, place names, administrative terms, and historical events. Every entity spawns meaningful research threads
4. **Narrative potential** -- The document tells a story (a decree about taxation, land grants, military orders). The documentary script writes itself into a compelling segment
5. **Emotional hook** -- "This 400-year-old document, written by a sultan's court scribe, has never been translated by AI before" is a line judges remember

**Backup choice: A page from the Dead Sea Scrolls (Isaiah Scroll)**
- Hebrew script, 2000+ years old, universally recognized
- Slightly less visual impact than the firman but higher name recognition

**Do not use:**
- English-language documents (undermines the multilingual selling point)
- Well-known documents already digitized everywhere (Magna Carta, Declaration of Independence -- judges will think "Google could already do this")
- Extremely damaged or illegible scans (if OCR visibly fails on screen, the demo is over)

---

## Shot List and Narration Script

### SHOT 1 -- Hook and Upload (0:00 -- 0:20)

**Screen:** App landing page. Upload drop zone centered. Parchment background, film grain visible.

**Action sequence:**
1. (0:00) App is visible. Pause 1 second to let judges absorb the design
2. (0:03) Drag the Ottoman firman PDF from desktop into the drop zone
3. (0:05) Drop zone animates -- archival corner brackets appear, progress bar fills
4. (0:08) Upload completes. Transition to workspace. PDF renders on the left

**Voiceover:**

> "This is a 16th-century Ottoman imperial decree. It has never been digitized, translated, or researched by any AI system. I am going to drop it into AI Historian, and in under a minute, it will produce a cinematic documentary -- with narration, original visuals, and a live AI historian I can interrupt mid-sentence."

**Production notes:**
- The voiceover must start immediately. No title card, no "Hi, I'm..." introduction. Judges review dozens of videos. The first 5 seconds determine whether they pay attention
- Show the document file name briefly on the desktop before dragging -- it should be something evocative like `ottoman_firman_1567.pdf`
- The drop animation and transition to workspace should feel seamless. If there is any loading delay, cut it in post

---

### SHOT 2 -- Expedition Log / Agents Working (0:20 -- 1:05)

**Screen:** Workspace view. PDF on left, Expedition Log loading on right. Agent cards appearing.

**Action sequence:**
1. (0:20) Expedition Log begins. "TRANSLATION & SCAN" phase marker appears
2. (0:25) Typewriter log entries stream in: "Detecting script: Ottoman Turkish...", "Extracting 847 characters across 3 text blocks..."
3. (0:32) "FIELD RESEARCH" phase marker. Agent cards appear with animated conic-gradient borders
4. (0:38) Multiple agents searching simultaneously -- cards show teal pulsing dots, source counts incrementing
5. (0:45) Stats bar: "12 SOURCES FOUND" counter flashes gold
6. (0:50) "SYNTHESIS" phase marker. Agent dots transition to gold shimmer
7. (0:55) "VISUAL COMPOSITION" phase marker. First segment card morphs from skeleton to real content -- title decodes from cipher glyphs
8. (1:05) Stats bar shows final counts. Segment card shows "Ready"

**Voiceover:**

> "The moment I upload, five AI agents launch in parallel. The first agent translates and maps the document structure. Then specialized research agents fan out -- each investigating a different entity: the sultan who issued this decree, the province it governed, the economic conditions of the era. Watch the sources accumulate in real time."

(pause 2 seconds -- let the visual do the work as agents search)

> "Now the synthesis agent weaves the research into a documentary script, and the visual director begins composing scenes. All of this took forty seconds."

**Production notes:**
- This is the technical credibility shot. Judges scoring "Technical Implementation" (30%) need to see real agent orchestration, not a loading spinner
- Let the Expedition Log breathe. Do not talk over every single log entry. The typewriter animation sells itself
- If agent timing is inconsistent between takes, pick the take where agents finish closest together -- visual parallel execution is the key impression
- The stats bar counter incrementing is a subtle but powerful proof of real work happening

---

### SHOT 3 -- Documentary Playback (1:05 -- 1:50)

**Screen:** Click the first segment card. Iris reveal transition to documentary player. Full-screen cinematic.

**Action sequence:**
1. (1:05) Click the first ready segment card
2. (1:07) Iris reveal transition -- radial mask closes then opens on player
3. (1:10) Ken Burns animation begins on the first Imagen 3 generated image. AI narrator voice starts
4. (1:15) Captions reveal word by word, synced to narration
5. (1:25) Image transitions to second frame -- cross-dissolve with subtle scale
6. (1:35) If Veo 2 video is available for this segment, it plays here. If not, continue with Ken Burns on a third image
7. (1:50) Let the narration continue for a few more seconds to establish the tone

**Voiceover:**

> "This is not a slideshow. Every image was generated by Imagen 3 using historically researched visual descriptions. The narration is Gemini 2.5 Flash with native audio -- a distinct historian persona, not a text-to-speech voice. And the captions reveal in sync, word by word."

(pause -- let the historian's voice play for at least 5 seconds uninterrupted so judges hear the quality)

**Production notes:**
- This is the "Innovation & Multimodal UX" shot (40% of score). The iris transition, Ken Burns with audio-reactive speed changes, and word-by-word captions are the three things that separate this from every other project
- Reduce your voiceover volume during the historian narration. Both voices at full volume creates mud. Your voice should dip to 70% while the historian speaks, then return to 100% when you comment
- The generated images must look good. If the first take produces mediocre Imagen 3 results, re-run the pipeline or use a take where the images are strong. Judges will form their entire visual quality opinion from whatever image appears first
- If Veo 2 video is ready, this is the single most impressive moment in the entire demo. A generated video clip of a historical scene, narrated by an AI historian, with synced captions. Let it play for at least 4 seconds without talking over it

---

### SHOT 4 -- Live Voice Interruption (1:50 -- 2:40)

**Screen:** Documentary player still active. Voice button visible.

**Action sequence:**
1. (1:50) Historian is mid-sentence narrating the documentary
2. (1:53) User speaks: "Wait -- who was this sultan? Why did he issue this decree?"
3. (1:54) Historian stops mid-word. Voice button transitions to `listening` state. Waveform shows user audio
4. (1:57) Voice button shows `processing` briefly, then `historian_speaking`
5. (1:58) Historian responds conversationally: answers the question with context from the research, speaks naturally for 15-20 seconds
6. (2:20) Historian finishes response. Offers to continue: "Shall I continue where we left off?"
7. (2:25) User says: "Yes, continue"
8. (2:27) Documentary resumes from the interruption point. Ken Burns animation restarts. Narration picks up

**Voiceover (before speaking to the historian):**

> "Here is what makes this different from every documentary you have ever watched. I can speak to the historian at any moment."

(now speak directly to the historian -- your voice switches from "narrator explaining to judges" to "user asking a question")

**Voiceover (after the historian responds and resumes):**

> "Sub-second interruption. Contextual response grounded in the research. Seamless resume. This is the Live Agent."

**Production notes:**
- This is the single most important shot in the entire demo. It proves the "Live Agent" category claim and demonstrates the core differentiator
- Rehearse the interruption question. Pick a question whose answer you know the historian will handle well based on the document content. Do not ask something that risks a hallucination or a confused response during the recording
- The interruption must be mid-sentence. Not at a pause, not at the end of a thought. The historian must audibly stop mid-word. This is the moment judges remember
- If the latency is noticeable (>1 second between your question ending and the historian starting), mention it: "Under 300 milliseconds from my voice to the historian's response." Framing the metric makes judges evaluate it as a feature, not a flaw
- Record this shot 3-5 times. Use the take with the fastest interruption response and the most coherent historian answer

---

### SHOT 5 -- Agent Modal / Research Depth (2:40 -- 3:15)

**Screen:** Return to workspace (or open agent modal from player sidebar). Show research depth.

**Action sequence:**
1. (2:40) Click on one of the research agent cards in the Research Panel
2. (2:42) Agent Modal opens (Radix Dialog). Shows the full agent session log
3. (2:45) Scroll through: query issued, sources discovered, source evaluation (accepted/rejected with shimmer animation), extracted facts, visual prompt generated
4. (2:55) Close modal. Click a different agent to show it researched a different topic
5. (3:00) Briefly show the segment card detail -- sources listed, mood tag, narration script preview
6. (3:10) Close and prepare for architecture transition

**Voiceover:**

> "Every research agent is fully transparent. This agent searched for the economic conditions of 16th-century Anatolia. It found fourteen sources, evaluated each one for historical reliability, rejected three as unreliable, and extracted the facts that became part of the documentary script. This is not a black box. Every claim in the documentary traces back to a grounded source."

**Production notes:**
- This shot serves judges scoring "Technical Implementation" (30%). They need to see that the agent pipeline is not a single Gemini prompt with Google Search stapled on
- Scroll slowly through the agent log. Judges need to read the entries. If you scroll too fast, the depth is invisible
- Highlight the source evaluation step -- the fact that the system accepts and rejects sources is a strong differentiator from "I just Googled it"
- If the agent modal has good visual design (shimmer animations on source evaluation, status dot transitions), let those animations play without rushing past them

---

### SHOT 6 -- Architecture and GCP Proof (3:15 -- 3:50)

**Screen:** Architecture diagram, then GCP console.

**Action sequence:**
1. (3:15) Switch to a browser tab with the architecture diagram (full-screen, clean background)
2. (3:20) Pause on the diagram for 5 seconds. Let judges read it
3. (3:25) Switch to GCP console. Cloud Run services page showing 3 services: `historian-api`, `agent-orchestrator`, `live-relay`
4. (3:30) Click into `agent-orchestrator` service. Show it is running, revision active, metrics visible
5. (3:35) Briefly show Firestore console with session data (blur any sensitive keys)
6. (3:40) Briefly show Cloud Storage bucket with generated images visible
7. (3:45) Back to the app for closing

**Voiceover:**

> "The system runs entirely on Google Cloud. Three Cloud Run services: the FastAPI gateway, the ADK agent orchestrator, and the live relay for Gemini's real-time audio. Firestore holds session state and agent logs. Cloud Storage stores every generated image and video. Document AI handles the multilingual OCR. This is not a local demo -- it is a deployed, scalable production system."

**Production notes:**
- The architecture diagram must be a clean, readable image -- not a cluttered whiteboard photo. Use Mermaid, draw.io, or Excalidraw
- The diagram must show: User/Browser at top, three Cloud Run services in the middle, Gemini/Imagen/Veo 2 on the right, Firestore/GCS/Document AI/Pub/Sub at the bottom. Arrows labeled with protocols (REST, SSE, WebSocket, gRPC)
- GCP console proof is mandatory for the competition. Show real running services with green status indicators
- Do not linger on the GCP console. 15 seconds is enough. Judges need proof, not a Cloud Run tutorial
- If Terraform was used, mention it: "Infrastructure provisioned with Terraform -- `terraform apply` deploys everything"

---

### SHOT 7 -- Closing (3:50 -- 3:58)

**Screen:** Return to the app. Documentary player showing a beautiful generated image with the historian's voice faintly audible.

**Action sequence:**
1. (3:50) App is visible. A generated documentary image fills the screen
2. (3:55) Fade to end card or simply let the image hold

**Voiceover:**

> "AI Historian. Upload any document, in any language, from any era. Watch it become a documentary you can talk to. Built with Gemini, ADK, Imagen 3, Veo 2, and Google Cloud."

**Production notes:**
- End with the product, not with your face or a title card
- List the Google technologies by name. Judges are from Google. They want to hear their products used correctly
- Do not say "thank you" or "we hope you enjoyed." End on the product statement and stop

---

## Timing Summary

| Shot | Time | Duration | Content | Judging Target |
|---|---|---|---|---|
| 1 | 0:00--0:20 | 20s | Hook + upload | First impression |
| 2 | 0:20--1:05 | 45s | Expedition Log + agents | Technical (30%) |
| 3 | 1:05--1:50 | 45s | Documentary playback | Innovation/UX (40%) |
| 4 | 1:50--2:40 | 50s | Voice interruption | Innovation/UX (40%) + Live Agent |
| 5 | 2:40--3:15 | 35s | Agent Modal depth | Technical (30%) |
| 6 | 3:15--3:50 | 35s | Architecture + GCP | Technical (30%) + Mandatory proof |
| 7 | 3:50--3:58 | 8s | Closing statement | Memorability |
| **Total** | | **3:58** | | |

---

## Voiceover Recording Rules

1. **Write the script, then cut 30% of the words.** Every sentence that does not advance the judge's understanding gets deleted. Judges watch dozens of videos. Density wins
2. **Never read from the screen.** Your voiceover explains what the judges are seeing, it does not describe the UI element by element. "Click the upload button" is wasted breath. "This 400-year-old decree has never been translated by AI" is a hook
3. **Speak at presentation pace, not conversation pace.** Slightly slower than natural. Enunciate. No filler words ("um", "so", "basically")
4. **Record voiceover separately from screen recording.** Record screen first, then record voiceover while watching the screen recording. Sync in post. This produces dramatically better audio than narrating live
5. **Use a pop filter or speak at a 45-degree angle to the mic.** Plosives ("p", "b") ruin otherwise clean audio
6. **Do not speed up the voiceover in post.** If the script is too long for the time, cut words. Chipmunk audio destroys credibility
7. **Leave 2-3 intentional silence gaps.** Silence during the Expedition Log typing and during the historian's voice forces judges to watch and listen. Silence is a power move, not dead air

---

## Post-Production Checklist

- [ ] Total duration under 4:00 (target 3:45--3:55)
- [ ] Audio levels normalized: voiceover at -14 LUFS, app audio at -20 LUFS
- [ ] No personal information visible (email, API keys, file paths with username)
- [ ] All loading/waiting periods trimmed with jump cuts (except Expedition Log which is the show)
- [ ] Captions/subtitles added (YouTube auto-captions are acceptable but verify accuracy)
- [ ] Video uploaded to YouTube as unlisted, "Not for Kids" selected
- [ ] Video plays without authentication (test in incognito browser)
- [ ] Video description includes: project name, GitHub link, team members
- [ ] Watched the final export end-to-end at 1x speed on a phone screen (if text is unreadable on phone, judges on small screens will struggle)

---

## Common Mistakes That Lose Points

| Mistake | Why It Hurts | Fix |
|---|---|---|
| Starting with "Hi, I'm X and this is our project Y" | Judges stop paying attention during introductions. 15 seconds wasted | Start with the action. Upload the document in the first 3 seconds |
| Showing a title card or logo animation for 5+ seconds | Not a Super Bowl commercial. Judges want to see working software | No title card. Start on the app |
| Talking about the problem for 30+ seconds before showing anything | Judges already read the Devpost description. They opened the video to see the product | Show the product working within the first 10 seconds. Explain the problem while it works |
| Speeding up the video to fit the time limit | Makes the UI look janky and the voice sound unnatural | Cut content instead. Better to show 4 features clearly than 7 features in fast-forward |
| Not showing the interruption working | The single biggest differentiator goes undemonstrated | Dedicate 50 seconds to the voice interaction. It is worth it |
| Ending with "we ran out of time but we plan to add..." | Signals incomplete work | End on what it does, not what it does not do |
| Poor audio quality | Immediate credibility loss. Judges assume the product is as rough as the video | External mic, quiet room, post-process noise reduction |
| Never showing GCP console | Mandatory requirement. Automatic disqualification risk | Spend 15 seconds on GCP console. Boring but required |

---

## Rehearsal Schedule

| Day | Task |
|---|---|
| Day 1 | Write voiceover script. Time each section with a stopwatch. Cut to fit |
| Day 1 | Do 2 full practice runs of the screen recording flow (no voiceover). Identify any loading delays or visual glitches to work around |
| Day 2 | Record screen capture. Do 3 takes of the full flow. Keep the best one |
| Day 2 | Record voiceover. Do 3 takes per section. Keep the best delivery per section |
| Day 2 | Edit: sync voiceover to screen recording, add jump cuts for loading, normalize audio |
| Day 3 | Watch the edit on a phone. Fix any readability issues. Re-record any voiceover sections that feel rushed |
| Day 3 | Export final video. Upload to YouTube. Verify playback in incognito. Submit to Devpost |

---

## Research Sources

- [6 Tips for Making a Winning Hackathon Demo Video -- Devpost](https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video)
- [Video-Making Best Practices -- Devpost Help Center](https://help.devpost.com/article/84-video-making-best-practices)
- [How to Win a Hackathon: Advice from 5 Seasoned Judges -- Devpost](https://info.devpost.com/blog/hackathon-judging-tips)
- [Understanding Hackathon Submission and Judging Criteria -- Devpost](https://info.devpost.com/blog/understanding-hackathon-submission-and-judging-criteria)
- [How to Present a Successful Hackathon Demo -- Devpost](https://info.devpost.com/blog/how-to-present-a-successful-hackathon-demo)
- [Creating the Best Demo Video for a Hackathon -- Hackathon Tips](https://tips.hackathon.com/article/creating-the-best-demo-video-for-a-hackathon-what-to-know)
- [Screen Studio -- Professional Screen Recorder for macOS](https://screen.studio/)
