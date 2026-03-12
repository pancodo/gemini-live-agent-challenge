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
  const resumptionToken = useVoiceStore((s) => s.resumptionToken);
  const setResumptionToken = useVoiceStore((s) => s.setResumptionToken);

  const { state, transition, handleInterrupt, reset } = useVoiceState();
  const playback = useAudioPlayback();

  const { sendPCM, sendText, connect, disconnect, isConnected } = useGeminiLive({
    sessionId,
    resumptionToken,
    onAudioChunk: (pcm: ArrayBuffer) => {
      playback.enqueue(pcm);
      if (useVoiceStore.getState().state !== 'historian_speaking') {
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

  /** Start voice session with an initial text prompt to the historian. */
  const handleSpeak = useCallback(() => {
    const currentState = useVoiceStore.getState().state;
    if (currentState !== 'idle') return;

    connect();
    void capture.start();
    transition('listening');

    // Send an initial greeting after a brief delay to allow setup to complete
    setTimeout(() => {
      sendText('Hello! Please introduce yourself briefly and tell me about the document I uploaded.');
    }, 1500);
  }, [connect, capture, transition, sendText]);

  // Register beginConsultation in store so HistorianPanel can invoke it
  const setBeginConsultation = useVoiceStore((s) => s.setBeginConsultation);
  useEffect(() => {
    setBeginConsultation(handleSpeak);
    return () => setBeginConsultation(null);
  }, [handleSpeak, setBeginConsultation]);

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
