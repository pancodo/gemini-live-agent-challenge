import { useCallback, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useVoiceStore } from '../store/voiceStore';
import type { VoiceState } from '../types';

/**
 * Voice button state machine hook.
 *
 * Valid transitions:
 *   idle -> listening            (user clicks mic OR VAD detects speech)
 *   listening -> processing      (VAD detects speech end)
 *   processing -> historian_speaking (server audio starts)
 *   historian_speaking -> interrupted (server sends interrupted=true)
 *   interrupted -> listening     (auto-transition after 250ms flash)
 *   any -> idle                  (session ends or error)
 */

const VALID_TRANSITIONS: Record<VoiceState, readonly VoiceState[]> = {
  idle: ['listening', 'reconnecting'],
  listening: ['processing', 'idle', 'reconnecting'],
  processing: ['historian_speaking', 'idle', 'reconnecting'],
  historian_speaking: ['interrupted', 'idle', 'reconnecting'],
  interrupted: ['listening', 'idle', 'reconnecting'],
  reconnecting: ['listening', 'idle'],
} as const;

export function useVoiceState() {
  const { state, setState, setResume, clearResume } = useVoiceStore(
    useShallow((s) => ({
      state: s.state,
      setState: s.setState,
      setResume: s.setResume,
      clearResume: s.clearResume,
    }))
  );

  const interruptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const transition = useCallback(
    (next: VoiceState) => {
      const current = useVoiceStore.getState().state;
      // Always allow transition to idle (reset)
      if (next === 'idle' || VALID_TRANSITIONS[current].includes(next)) {
        setState(next);
      }
    },
    [setState],
  );

  const handleInterrupt = useCallback(
    (segmentId: string, offset: number) => {
      setResume(segmentId, offset);
      setState('interrupted');
      // Flash interrupted state, then immediately transition to listening
      if (interruptTimerRef.current !== null) {
        clearTimeout(interruptTimerRef.current);
      }
      interruptTimerRef.current = setTimeout(() => {
        interruptTimerRef.current = null;
        setState('listening');
      }, 250);
    },
    [setState, setResume],
  );

  const reset = useCallback(() => {
    if (interruptTimerRef.current !== null) {
      clearTimeout(interruptTimerRef.current);
      interruptTimerRef.current = null;
    }
    clearResume();
    setState('idle');
  }, [setState, clearResume]);

  return { state, transition, handleInterrupt, reset } as const;
}
