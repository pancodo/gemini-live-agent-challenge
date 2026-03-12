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

  const { sendPCM, sendText, connect, disconnect, reconnect, isConnected } = useGeminiLive({
    sessionId,
    resumptionToken,
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
        transition('idle');
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
        void capture.start();
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

    connect();
    void capture.start();
    transition('listening');

    // Send an initial greeting after a brief delay to allow setup to complete
    setTimeout(() => {
      sendText('Hello! Please introduce yourself briefly and tell me about the document I uploaded.');
    }, 1500);
  };

  // Register once on mount, clean up on unmount. The stable lambda
  // delegates to speakRef.current so it always calls the latest closure.
  useEffect(() => {
    useVoiceStore.setState({ beginConsultation: () => speakRef.current() });
    return () => useVoiceStore.setState({ beginConsultation: null });
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

  useEffect(() => {
    if (!isPlayerOpen) return;
    // Conversation mode when user is talking to historian in the player
    // (listening or historian responding to interruption)
    const isConversing = state === 'listening' || state === 'interrupted';
    setConversationMode(isConversing);
  }, [state, isPlayerOpen, setConversationMode]);

  // Hide on upload page (after all hooks per React rules)
  const location = useLocation();
  if (location.pathname === '/') return null;

  return (
    <VoiceButton
      voiceState={state}
      playbackAnalyser={playbackAnalyser}
      onToggle={handleToggle}
    />
  );
}
