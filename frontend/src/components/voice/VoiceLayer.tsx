/**
 * VoiceLayer — orchestrates the entire voice pipeline.
 *
 * Wires together useGeminiLive, useAudioCapture, useAudioPlayback,
 * and useVoiceState, then renders VoiceButton with the correct props.
 * Mounted inside the router layout so it has access to useLocation
 * and persists across page navigations.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { VoiceButton } from './VoiceButton';
import { useSessionStore } from '../../store/sessionStore';
import { useVoiceStore } from '../../store/voiceStore';
import { useVoiceState } from '../../hooks/useVoiceState';
import { useAudioPlayback } from '../../hooks/useAudioPlayback';
import { useGeminiLive } from '../../hooks/useGeminiLive';
import { useAudioCapture } from '../../hooks/useAudioCapture';
import { useAudioVisualSync } from '../../hooks/useAudioVisualSync';
import { usePlayerStore } from '../../store/playerStore';

export function VoiceLayer() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const resumptionToken = useVoiceStore((s) => s.resumptionToken);
  const setResumptionToken = useVoiceStore((s) => s.setResumptionToken);
  const loadResumptionToken = useVoiceStore((s) => s.loadResumptionToken);
  const clearResumptionToken = useVoiceStore((s) => s.clearResumptionToken);

  const { state, transition, handleInterrupt, reset } = useVoiceState();

  // Hydrate resumption token from localStorage on mount
  useEffect(() => {
    loadResumptionToken();
  }, [loadResumptionToken]);

  const playback = useAudioPlayback();

  // Pending text to send once the WebSocket setup completes (replaces fragile setTimeout)
  const pendingGreetingRef = useRef<string | null>(null);
  const sendTextStableRef = useRef((_t: string) => {});

  const { sendPCM, sendText, connect, disconnect, reconnect, isConnected } = useGeminiLive({
    sessionId,
    resumptionToken,
    onReady: () => {
      const text = pendingGreetingRef.current;
      if (text) {
        pendingGreetingRef.current = null;
        sendTextStableRef.current(text);
      }
    },
    onAudioChunk: (pcm: ArrayBuffer) => {
      playback.enqueue(pcm);
      // Push analyser to store for lip sync — created lazily on first enqueue,
      // so it may be null on the first chunk but available from the second onward
      if (!useVoiceStore.getState().analyserNode) {
        const analyser = playback.getAnalyser();
        if (analyser) useVoiceStore.getState().setAnalyserNode(analyser);
      }
      if (useVoiceStore.getState().state !== 'historian_speaking') {
        useVoiceStore.getState().setUserTranscript(null);
        transition('historian_speaking');
      }
    },
    onInterrupted: () => {
      playback.stop();
      const { resumeSegmentId, resumeOffset } = useVoiceStore.getState();
      handleInterrupt(resumeSegmentId ?? '', resumeOffset);
    },
    onTurnComplete: () => {
      const currentState = useVoiceStore.getState().state;
      if (currentState === 'historian_speaking') {
        // Read isNarrating ONCE to avoid race condition between two reads
        const narrating = usePlayerStore.getState().isNarrating;
        if (narrating) {
          // Advance to next beat (Effect 2b in DocumentaryPlayer handles the rest)
          usePlayerStore.getState().incrementBeatAdvanceSignal();
        } else {
          transition('idle');
        }
      }
    },
    onCaption: (text: string) => {
      useVoiceStore.getState().setCaption(text);
    },
    onResumeToken: (token: string) => {
      setResumptionToken(token);
    },
    onGoAway: () => {
      toast.warning('Session expiring, reconnecting...');
    },
    onReconnecting: (attempt: number, max: number) => {
      transition('reconnecting');
      toast.info(`Reconnecting... (attempt ${attempt}/${max})`);
    },
    onReconnectFailed: () => {
      transition('idle');
      toast.error('Connection lost', {
        action: {
          label: 'Reconnect',
          onClick: () => {
            reconnect();
          },
        },
        duration: Infinity,
      });
    },
    onResumptionExpired: () => {
      clearResumptionToken();
      toast.info('Session refreshed — historian context reloaded');
    },
  });

  // Keep sendText ref in sync so onReady always calls the latest version
  sendTextStableRef.current = sendText;

  const capture = useAudioCapture(sendPCM);

  // Track previous isConnected to detect unexpected disconnections
  const prevConnectedRef = useRef(isConnected);
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;

    if (wasConnected && !isConnected && useVoiceStore.getState().state !== 'idle') {
      // Soft reset: return to idle but keep the resumption token for reconnection
      transition('idle');
    }
  }, [isConnected, transition]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      capture.stop();
      disconnect();
      playback.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = useCallback(() => {
    const currentState = useVoiceStore.getState().state;

    switch (currentState) {
      case 'idle':
        connect();
        capture.start().catch(() => {
          // Mic permission denied — disconnect and reset
          disconnect();
          reset();
        });
        transition('listening');
        break;

      case 'listening':
        capture.stop();
        disconnect();
        reset();
        clearResumptionToken();
        break;

      case 'historian_speaking':
        playback.stop();
        void capture.start();
        transition('listening');
        break;

      case 'reconnecting':
        // Manual retry — reset attempts and reconnect
        disconnect();
        connect();
        void capture.start();
        transition('listening');
        break;

      default:
        // processing, interrupted — no-op
        break;
    }
  }, [connect, disconnect, capture, playback, transition, reset, clearResumptionToken]);

  // Stable ref for beginConsultation to avoid re-render loops.
  // The ref always points at the latest closure so callers get fresh state.
  const speakRef = useRef(() => {});
  speakRef.current = () => {
    const currentState = useVoiceStore.getState().state;
    if (currentState !== 'idle') return;

    // Queue greeting — sent reliably when onReady fires (no fragile setTimeout)
    pendingGreetingRef.current = 'Hello! Please introduce yourself briefly and tell me about the document I uploaded.';
    connect();
    capture.start().catch(() => { disconnect(); reset(); });
    transition('listening');
  };

  // Stable ref for sendTextToHistorian — same pattern as beginConsultation.
  const sendTextRef = useRef((_text: string) => {});
  sendTextRef.current = (text: string) => {
    const currentState = useVoiceStore.getState().state;
    if (currentState === 'idle') {
      // Queue text — sent reliably when onReady fires
      pendingGreetingRef.current = text;
      connect();
      transition('historian_speaking');
    } else {
      sendTextStableRef.current(text);
    }
  };

  // Preconnect: open WebSocket without mic, so Play click sends text instantly.
  const preconnectRef = useRef(() => {});
  preconnectRef.current = () => {
    const currentState = useVoiceStore.getState().state;
    if (currentState !== 'idle') return;
    if (isConnected) return;
    connect();
  };

  // Register once on mount, clean up on unmount. The stable lambda
  // delegates to speakRef.current so it always calls the latest closure.
  useEffect(() => {
    useVoiceStore.setState({
      beginConsultation: () => speakRef.current(),
      sendTextToHistorian: (text: string) => sendTextRef.current(text),
      preconnect: () => preconnectRef.current(),
    });
    return () => useVoiceStore.setState({
      beginConsultation: null,
      sendTextToHistorian: null,
      preconnect: null,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const playbackAnalyser = playback.getAnalyser();
  useAudioVisualSync(playbackAnalyser);

  // Expose analyser to voiceStore for HistorianAvatar lip sync.
  // The analyser is created lazily on first enqueue, so we re-check
  // when voice state changes (e.g. to historian_speaking after first chunk).
  const currentAnalyserInStore = useVoiceStore((s) => s.analyserNode);
  useEffect(() => {
    const analyser = playback.getAnalyser();
    if (analyser && analyser !== currentAnalyserInStore) {
      useVoiceStore.getState().setAnalyserNode(analyser);
    }
  }, [state, playback, currentAnalyserInStore]);

  // Set conversation mode in player when user interrupts historian
  const isPlayerOpen = usePlayerStore((s) => s.isOpen);
  const setConversationMode = usePlayerStore((s) => s.setConversationMode);

  const wasHistorianSpeakingRef = useRef(false);

  useEffect(() => {
    if (!isPlayerOpen) return;
    // Conversation mode ONLY when user interrupts the historian (not on initial narration).
    // Track if historian was speaking — only show portrait if user interrupts mid-narration.
    if (state === 'historian_speaking') {
      wasHistorianSpeakingRef.current = true;
    }
    const isConversing = state === 'interrupted' ||
      (state === 'listening' && wasHistorianSpeakingRef.current);
    if (state === 'idle') {
      wasHistorianSpeakingRef.current = false;
    }
    setConversationMode(isConversing);
  }, [state, isPlayerOpen, setConversationMode]);

  // Release voice session to idle when narration ends.
  // Delay 10s to allow auto-advance to restart narration for the next segment.
  // If isNarrating becomes true again (next segment started), cancel the idle.
  const isNarrating = usePlayerStore((s) => s.isNarrating);
  const idleDelayRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(idleDelayRef.current);
    if (!isNarrating) {
      idleDelayRef.current = setTimeout(() => {
        const currentState = useVoiceStore.getState().state;
        if (currentState === 'historian_speaking' && !usePlayerStore.getState().isNarrating) {
          transition('idle');
        }
      }, 10_000);
    }
    return () => clearTimeout(idleDelayRef.current);
  }, [isNarrating, transition]);

  // Hide on landing page and during pipeline processing (voice is useless until documentary is ready)
  const location = useLocation();
  const sessionStatus = useSessionStore((s) => s.status);
  if (location.pathname === '/') return null;
  if (location.pathname === '/workspace' && (sessionStatus === 'processing' || sessionStatus === 'uploading')) return null;

  return (
    <VoiceButton
      voiceState={state}
      playbackAnalyser={playbackAnalyser}
      onToggle={handleToggle}
    />
  );
}
