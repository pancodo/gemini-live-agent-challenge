# Building a Real-Time Voice Historian with Gemini Live API: Interruption, Resumption, and Sub-300ms Latency

*This post was written as part of my submission to the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) hackathon, organized by Google LLC and administered by Devpost.*

---

Imagine watching a documentary about an Ottoman manuscript you just uploaded. The narrator describes the court of Suleiman the Magnificent — and you interrupt: "Wait, who was the architect?" The narrator stops mid-word, answers your question with sourced facts, and picks the story back up. That is what we built.

The product is called **AI Historian**. My teammate Efe owns the research pipeline (7 AI agents that OCR, research, script, and generate visuals). I own the voice layer — the live historian persona that narrates the documentary and handles real-time conversation. This post is about the voice side: how we got a Gemini-powered historian to stop talking within 300 milliseconds of a user speaking.

## Why a WebSocket Relay, Not Direct Browser-to-Gemini

The Gemini Live API is a persistent bidirectional WebSocket. The browser could technically connect directly, but that would expose our API key in client-side JavaScript. So we built a Node.js relay service (`live-relay`) that runs on Cloud Run and sits between the browser and Gemini.

```
Browser <--WebSocket--> live-relay (Cloud Run) <--WebSocket--> Gemini Live API
```

The relay authenticates with Google using the API key (injected from Secret Manager). The browser authenticates with our backend using the session ID. The relay also does something important before connecting to Gemini: it fetches the documentary context from Firestore — the segments, sources, visual bible, and research facts — and injects them into the system instruction. The historian persona actually knows what the documentary showed because it has read the research.

```javascript
const context = await fetchDocumentaryContext(sessionId);
const systemText = buildSystemInstruction(context);
```

We cache the system instruction in memory with a 15-minute TTL. If the user reconnects, we do not hit Firestore again.

## The First Message: BidiGenerateContentSetup

This tripped us up early. After the WebSocket connects, the very first message you send **must** be `BidiGenerateContentSetup`. If you send audio data before the server replies with `setupComplete`, nothing happens. No error. No warning. Just silence.

Here is the exact structure we send:

```javascript
const setupMessage = {
  setup: {
    model: `models/gemini-2.5-flash-native-audio-preview-12-2025`,
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: 'Puck' },
        },
      },
    },
    systemInstruction: {
      parts: [{ text: systemText }],
    },
    realtimeInputConfig: {
      automaticActivityDetection: { disabled: false },
    },
    contextWindowCompression: {
      slidingWindow: {},
    },
  },
};
```

A few things worth noting. `automaticActivityDetection` being enabled means Gemini handles voice activity detection on the server side — we do not need to detect silence in the browser. `contextWindowCompression.slidingWindow` removes the 15-minute session limit and gives us unlimited conversation length. And `responseModalities: ['AUDIO']` means Gemini generates native audio directly — no separate TTS step.

## Browser Audio: 16kHz In, 24kHz Out

The browser captures microphone audio with `getUserMedia`, pipes it through an `AudioWorkletNode`, and encodes it as 16-bit PCM at 16,000 Hz in 1024-byte chunks. We use AudioWorklet (not the deprecated `ScriptProcessorNode`) because it runs on a separate thread. This matters when the main thread is busy rendering documentary visuals with Ken Burns animations and waveform visualizers.

The chunks are base64-encoded and sent as `realtimeInput.mediaChunks`:

```javascript
geminiWs.send(JSON.stringify({
  realtimeInput: {
    mediaChunks: [{
      mimeType: 'audio/pcm;rate=16000',
      data: base64AudioChunk,
    }],
  },
}));
```

Audio coming back from Gemini is 24kHz PCM — different sample rate than input. Each chunk goes into a playback queue backed by `AudioBufferSourceNode`. The tricky part is scheduling: chunks arrive in bursts, faster than real-time playback during the initial response. Each `AudioBufferSourceNode.start(nextStartTime)` call must be timed precisely so chunks play back-to-back without gaps or overlaps.

## Interruption: < 300ms from Speech to Silence

This is the feature that makes or breaks the live persona experience. When the user starts speaking while the historian is narrating, Gemini detects it server-side and sends:

```json
{ "serverContent": { "interrupted": true } }
```

The relay forwards this to the browser immediately as `{ "type": "interrupted" }`. The browser then does three things:

1. Stops the currently playing `AudioBufferSourceNode`
2. Flushes every queued audio chunk (including in-flight ones)
3. Updates the voice state machine so the UI reflects that the historian is listening

The total latency budget breaks down roughly as: ~50ms for the network round-trip through the relay, ~20ms to disconnect and garbage-collect the audio nodes, ~30ms for the React state update and UI repaint. In practice we measured consistently under 300ms from the user's first syllable to silence.

One edge case we hit: audio chunks that are in-flight (sent by Gemini before it detected the interruption) can arrive after the `interrupted` signal. The queue flush handles this — any audio arriving while the voice state is "listening" gets silently dropped.

## Session Resumption via Firestore

Gemini Live sessions can disconnect — network blips, Cloud Run cold starts, the user switching tabs. The API provides a resumption mechanism: periodically, Gemini sends a `sessionResumptionUpdate` message containing a `handle` token. We relay this to the browser:

```javascript
if (msg.sessionResumptionUpdate?.handle) {
  clientWs.send(JSON.stringify({
    type: 'resumption_token',
    token: msg.sessionResumptionUpdate.handle,
  }));
}
```

The browser stores this token. If Gemini sends a `goAway` signal (graceful shutdown) or the WebSocket drops, the browser reconnects to the relay with the token as a query parameter:

```
wss://live-relay/session/abc123?token=RESUMPTION_HANDLE
```

The relay includes it in the setup message's `sessionResumption.handle` field. Gemini restores the full conversation context — the historian remembers everything. The token is valid for 2 hours, which covers most real-world interruptions.

## Gotchas We Hit

**The dead model ID.** We initially used `gemini-2.0-flash-live-001` because that is what appeared in several tutorials. It was shut down on December 9, 2025. No deprecation warning — just connection failures. The correct model IDs are `gemini-2.5-flash-native-audio-preview-12-2025` (AI Studio) or `gemini-live-2.5-flash-native-audio` (Vertex AI).

**PCM sample rate mismatch.** We spent two hours debugging garbled audio before realizing we were playing back 24kHz PCM at 16kHz. The input and output sample rates are different. The API documentation mentions this, but it is easy to miss when you are wiring things up late at night.

**Cloud Run and WebSockets.** Cloud Run supports WebSockets, but the container will be suspended between requests if you are using the default CPU allocation. For a WebSocket relay that needs to stay alive, you must set `--cpu-always-allocated`. Without it, the container sleeps between frames and the audio stutters.

**System instruction size.** When the documentary has 6 scenes with full research and source citations, the system instruction can get large. We had to be selective about what context we inject — the full visual bible, segment titles, and key facts, but not every raw research output verbatim.

## What I Would Do Differently

I would build a proper audio codec layer on the browser side from day one. Raw PCM over WebSocket works, but the bandwidth is significant. Opus encoding at the browser level would cut the data in half and reduce latency on slower connections.

I would also invest earlier in a visual connection state indicator. When the WebSocket drops and reconnects, the user needs to know the historian is temporarily unavailable. We built this, but it should have been in place before we started testing anything else.

The Gemini Live API is genuinely impressive for building conversational AI that feels alive. The server-side VAD, native audio generation, and interruption handling do most of the heavy lifting. The engineering challenge is everything around it: the relay, the audio pipeline, the state management, and making it all feel seamless inside a documentary that is generating itself in real time.

---

The full source code is at [github.com/pancodo/gemini-live-agent-challenge](https://github.com/pancodo/gemini-live-agent-challenge). The relay service is in `backend/live_relay/`. If you want to see how the research pipeline feeds context to the historian, check out Efe's post about the 7-agent ADK pipeline.

`#GeminiLiveAgentChallenge`
