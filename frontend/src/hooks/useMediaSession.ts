import { useEffect, useRef } from 'react';
import type { Segment } from '../types';

interface MediaSessionHandlers {
  onNextTrack?: () => void;
  onPreviousTrack?: () => void;
}

/**
 * useMediaSession — Integrates with the Media Session API to expose
 * documentary segment metadata and transport controls to the OS
 * (lock screen, media overlay, headphone buttons, etc.).
 *
 * Updates metadata whenever the active segment changes and registers
 * action handlers for next/previous track navigation.
 */
export function useMediaSession(
  segment: Segment | null,
  handlers: MediaSessionHandlers = {},
): void {
  const { onNextTrack, onPreviousTrack } = handlers;

  const nextRef = useRef(onNextTrack);
  const prevRef = useRef(onPreviousTrack);
  useEffect(() => { nextRef.current = onNextTrack; }, [onNextTrack]);
  useEffect(() => { prevRef.current = onPreviousTrack; }, [onPreviousTrack]);

  // ── Metadata ────────────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator) || !segment) return;

    const artwork: MediaImage[] = segment.imageUrls
      .slice(0, 1)
      .map((src) => ({ src, sizes: '512x512', type: 'image/jpeg' }));

    navigator.mediaSession.metadata = new MediaMetadata({
      title: segment.title,
      artist: 'AI Historian',
      album: 'Documentary Session',
      artwork,
    });
  }, [segment?.id, segment?.title, segment?.imageUrls]);

  // ── Action handlers ─────────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    const actions: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
      ['nexttrack', () => nextRef.current?.()],
      ['previoustrack', () => prevRef.current?.()],
    ];

    for (const [action, handler] of actions) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Not all actions are supported on every platform
      }
    }

    return () => {
      for (const [action] of actions) {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch {
          // Cleanup best-effort
        }
      }
    };
  }, []);

  // ── Playback state sync ─────────────────────────────────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;

    // The documentary player is always "playing" when a segment is active,
    // since Ken Burns animation and potential audio narration are running.
    navigator.mediaSession.playbackState = segment ? 'playing' : 'none';

    return () => {
      navigator.mediaSession.playbackState = 'none';
    };
  }, [segment?.id]);
}
