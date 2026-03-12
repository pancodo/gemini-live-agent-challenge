import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '../store/playerStore';

// ── Wire protocol types ────────────────────────────────────────
type RelayMessage =
  | { type: 'ready' }
  | { type: 'audio'; data: string }
  | { type: 'interrupted' }
  | { type: 'turn_complete' }
  | { type: 'caption'; text: string }
  | { type: 'resumption_token'; token: string }
  | { type: 'go_away' }
  | { type: 'transcript'; text: string }
  | { type: 'live_illustration'; imageUrl: string; caption: string }
  | { type: 'error'; message: string };

// ── Public interface ───────────────────────────────────────────
export interface GeminiLiveConfig {
  sessionId: string | null;
  resumptionToken: string | null;
  onAudioChunk: (pcm: ArrayBuffer) => void;
  onInterrupted: () => void;
  onTurnComplete: () => void;
  onCaption: (text: string) => void;
  onResumeToken: (token: string) => void;
}

export interface GeminiLiveReturn {
  sendPCM: (chunk: Int16Array) => void;
  sendText: (text: string) => void;
  connect: () => void;
  disconnect: () => void;
  isConnected: boolean;
  lastUserTranscript: string | null;
}

// ── Base64 helpers ─────────────────────────────────────────────

/** Converts an ArrayBuffer to a base64 string without stack overflow. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Decodes a base64 string back to an ArrayBuffer. */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

// ── Constants ──────────────────────────────────────────────────
const WS_BASE = import.meta.env.VITE_WS_BASE_URL ?? 'ws://localhost:8001';
const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 500;

// ── Hook ───────────────────────────────────────────────────────
export function useGeminiLive(config: GeminiLiveConfig): GeminiLiveReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [lastUserTranscript, setLastUserTranscript] = useState<string | null>(null);

  // Stable refs for mutable state
  const wsRef = useRef<WebSocket | null>(null);
  const isReadyRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep config callbacks in a ref so the message handler never goes stale
  const configRef = useRef(config);
  configRef.current = config;

  const disconnect = useCallback(() => {
    // Clear any pending reconnect
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000, 'user disconnect');
    }
    wsRef.current = null;
    isReadyRef.current = false;
    setIsConnected(false);
  }, []);

  const connect = useCallback(() => {
    const { sessionId, resumptionToken } = configRef.current;

    // No-op without a session
    if (!sessionId) return;

    // Idempotent: don't open a second connection
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    // Build URL
    let url = `${WS_BASE}/session/${sessionId}`;
    if (resumptionToken) {
      url += `?token=${encodeURIComponent(resumptionToken)}`;
    }

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
    });

    ws.addEventListener('message', (event: MessageEvent<string>) => {
      let msg: RelayMessage;
      try {
        msg = JSON.parse(event.data) as RelayMessage;
      } catch {
        console.error('[useGeminiLive] Failed to parse relay message:', event.data);
        return;
      }

      const cfg = configRef.current;

      switch (msg.type) {
        case 'ready':
          isReadyRef.current = true;
          break;

        case 'audio':
          cfg.onAudioChunk(base64ToArrayBuffer(msg.data));
          break;

        case 'interrupted':
          cfg.onInterrupted();
          break;

        case 'turn_complete':
          cfg.onTurnComplete();
          break;

        case 'caption':
          cfg.onCaption(msg.text);
          break;

        case 'resumption_token':
          cfg.onResumeToken(msg.token);
          break;

        case 'go_away':
          // Server is shutting down; attempt reconnect
          reconnect();
          break;

        case 'transcript':
          setLastUserTranscript(msg.text);
          break;

        case 'live_illustration': {
          if (msg.imageUrl) {
            usePlayerStore.getState().setLiveIllustration({
              imageUrl: msg.imageUrl,
              caption: msg.caption,
              receivedAt: Date.now(),
            });
          }
          break;
        }

        case 'error':
          console.error('[useGeminiLive] Relay error:', msg.message);
          break;
      }
    });

    ws.addEventListener('close', (event: CloseEvent) => {
      setIsConnected(false);
      isReadyRef.current = false;

      // Auto-reconnect on unexpected closure (not user-initiated 1000)
      if (event.code !== 1000 && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnect();
      }
    });

    ws.addEventListener('error', (event) => {
      console.error('[useGeminiLive] WebSocket error:', event);
      // The browser will fire 'close' after 'error', so state cleanup happens there
    });
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps -- disconnect is stable, configRef is a ref

  const reconnect = useCallback(() => {
    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.error(
        `[useGeminiLive] Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`
      );
      return;
    }

    reconnectAttemptsRef.current += 1;
    const attempt = reconnectAttemptsRef.current;

    // Clean up the old socket before reconnecting
    const ws = wsRef.current;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000, 'reconnecting');
    }
    wsRef.current = null;
    isReadyRef.current = false;

    // Exponential backoff: 500ms, 1500ms, 4500ms
    const delay = RECONNECT_DELAY_MS * Math.pow(3, attempt - 1);
    console.log(`[useGeminiLive] Reconnecting in ${delay}ms (attempt ${attempt}/${MAX_RECONNECT_ATTEMPTS})`);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, [connect]);

  const sendPCM = useCallback((chunk: Int16Array) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !isReadyRef.current) {
      return;
    }

    const payload = JSON.stringify({
      type: 'audio',
      data: arrayBufferToBase64(chunk.buffer as ArrayBuffer),
    });
    ws.send(payload);
  }, []);

  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !isReadyRef.current) {
      return;
    }

    ws.send(JSON.stringify({ type: 'text', text }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return { sendPCM, sendText, connect, disconnect, isConnected, lastUserTranscript };
}
