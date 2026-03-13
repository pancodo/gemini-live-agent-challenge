/**
 * VoiceLayer — orchestrates the entire voice pipeline.
 *
 * Wires together useGeminiLive, useAudioCapture, useAudioPlayback,
 * and useVoiceState, then renders VoiceButton with the correct props.
 * Mounted inside the router layout so it has access to useLocation
 * and persists across page navigations.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLocation } from 'react-router-dom';
import { VoiceButton } from './VoiceButton';
import { useSessionStore } from '../../store/sessionStore';
import { useVoiceStore } from '../../store/voiceStore';
import { useVoiceState } from '../../hooks/useVoiceState';
import { useAudioPlayback } from '../../hooks/useAudioPlayback';
import { useGeminiLive } from '../../hooks/useGeminiLive';
import { useAudioCapture } from '../../hooks/useAudioCapture';
import { useAudioVisualSync } from '../../hooks/useAudioVisualSync';

export function VoiceLayer() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const { resumptionToken, setResumptionToken } = useVoiceStore(
    useShallow((s) => ({ resumptionToken: s.resumptionToken, setResumptionToken: s.setResumptionToken })),
  );

  const { state, transition, handleInterrupt, reset } = useVoiceState();
  const playback = useAudioPlayback();

  const onAudioChunk = useCallback(
    (pcm: ArrayBuffer) => {
      playback.enqueue(pcm);
      if (useVoiceStore.getState().state !== 'historian_speaking') {
        transition('historian_speaking');
      }
    },
    [playback, transition],
  );

  const onInterrupted = useCallback(() => {
    playback.stop();
    const { resumeSegmentId, resumeOffset } = useVoiceStore.getState();
    handleInterrupt(resumeSegmentId ?? '', resumeOffset);
  }, [playback, handleInterrupt]);

  const onResumeToken = useCallback(
    (token: string) => {
      setResumptionToken(token);
    },
    [setResumptionToken],
  );

  const { sendPCM, connect, disconnect, isConnected } = useGeminiLive({
    sessionId,
    resumptionToken,
    onAudioChunk,
    onInterrupted,
    onResumeToken,
  });

  const capture = useAudioCapture(sendPCM);

  // Track previous isConnected to detect unexpected disconnections
  const prevConnectedRef = useRef(isConnected);
  useEffect(() => {
    const wasConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;

    if (wasConnected && !isConnected && useVoiceStore.getState().state !== 'idle') {
      reset();
    }
  }, [isConnected, reset]);

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
        break;

      case 'historian_speaking':
        playback.stop();
        void capture.start();
        transition('listening');
        break;

      default:
        // processing, interrupted — no-op
        break;
    }
  }, [connect, disconnect, capture, playback, transition, reset]);

  const playbackAnalyser = playback.getAnalyser();
  useAudioVisualSync(playbackAnalyser);

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
