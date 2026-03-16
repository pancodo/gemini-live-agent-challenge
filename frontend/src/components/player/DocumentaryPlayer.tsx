import { useState, useEffect, useCallback, useMemo, useRef, useTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import type { Segment } from '../../types';
import { usePlayerStore } from '../../store/playerStore';
import { useResearchStore } from '../../store/researchStore';
import { useVoiceStore } from '../../store/voiceStore';
import { useMediaSession } from '../../hooks/useMediaSession';
import { KenBurnsStage } from './KenBurnsStage';
import { CaptionTrack } from './CaptionTrack';
import { PlayerSidebar } from './PlayerSidebar';
import { ShareButton } from './ShareButton';
import { LivingPortrait } from '../voice/LivingPortrait';
import { resolveEra } from '../../utils/eraMapping';
import { useSessionStore } from '../../store/sessionStore';
import { TimelineMap } from './TimelineMap';
import { downloadImage, downloadImages, downloadVideo } from '../../utils/downloadImage';
import { toast } from 'sonner';
import type { MapViewMode } from '../../types';
import { startNarration } from '../../services/api';
import { useSettings } from '../../hooks/useSettings';

/**
 * PipelinePhaseLabel — Shows the current (latest) pipeline phase name.
 */
function PipelinePhaseLabel() {
  const phases = useResearchStore((s) => s.phases);
  const currentPhase = phases.length > 0 ? phases[phases.length - 1] : null;

  if (!currentPhase) return null;

  return (
    <span
      style={{
        fontFamily: 'var(--font-serif)',
        fontSize: 12,
        color: 'rgba(196, 149, 106, 0.8)',
        letterSpacing: '0.05em',
      }}
    >
      {currentPhase.label}
    </span>
  );
}

/**
 * PipelineStats — Condensed sources / segments counts from the research store.
 */
function PipelineStats() {
  const stats = useResearchStore((s) => s.stats);
  const agents = useResearchStore((s) => s.agents);
  const activeAgentCount = Object.values(agents).filter(
    (a) => a.status === 'searching' || a.status === 'evaluating',
  ).length;

  return (
    <>
      {stats.sourcesFound > 0 && <span>{stats.sourcesFound} sources</span>}
      {stats.segmentsReady > 0 && <span>{stats.segmentsReady} segments</span>}
      {activeAgentCount > 0 && (
        <span>{activeAgentCount} agent{activeAgentCount !== 1 ? 's' : ''} active</span>
      )}
    </>
  );
}

/**
 * DocumentaryPlayer — Full-screen cinematic player.
 *
 * Layers (bottom to top):
 *  1. KenBurnsStage  — background visuals
 *  2. Top bar        — logo, segment index, sidebar toggle (auto-hides)
 *  3. CaptionTrack   — word-by-word captions (always visible)
 *  4. Bottom bar     — navigation controls (auto-hides)
 *  5. PlayerSidebar  — segment list (slides in from right)
 */
export function DocumentaryPlayer() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mapHintDismissed, setMapHintDismissed] = useState(false);
  const [mapDiscoveryVisible, setMapDiscoveryVisible] = useState(false);
  const [settings, updateSetting] = useSettings();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const updateSettingRef = useRef(updateSetting);
  updateSettingRef.current = updateSetting;
  const [showPlayOverlay, setShowPlayOverlay] = useState(true);
  const [isSavingAll, startSaveAllTransition] = useTransition();
  const shortcutsRef = useRef<HTMLDivElement>(null);
  const shortcutsBtnRef = useRef<HTMLButtonElement>(null);
  /** Tracks the URL of whichever image KenBurnsStage is currently showing. */
  const activeImageUrlRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const sessionId = useSessionStore((s) => s.sessionId);
  const voiceState = useVoiceStore((s) => s.state);
  const setVoiceState = useVoiceStore((s) => s.setState);

  const currentSegmentId = usePlayerStore((s) => s.currentSegmentId);
  const isConversationMode = usePlayerStore((s) => s.isConversationMode);
  const liveIllustration = usePlayerStore((s) => s.liveIllustration);
  const isIdle = usePlayerStore((s) => s.isIdle);
  const setIdle = usePlayerStore((s) => s.setIdle);
  const open = usePlayerStore((s) => s.open);
  const pipelineComplete = usePlayerStore((s) => s.pipelineComplete);

  const [pipCollapsed, setPipCollapsed] = useState(false);

  const mapViewMode = usePlayerStore((s) => s.mapViewMode);
  const setMapViewMode = usePlayerStore((s) => s.setMapViewMode);

  const handlePinClick = useCallback((locationName: string) => {
    const send = useVoiceStore.getState().sendTextToHistorian;
    if (send) {
      send(`Tell me more about ${locationName} and its historical significance.`);
    } else {
      toast('Connect voice to ask about locations', {
        description: `Press Space or tap the voice button to ask about ${locationName}.`,
      });
    }
  }, []);

  const cycleMapMode = useCallback(() => {
    const modes: MapViewMode[] = ['ken-burns', 'split', 'map'];
    const idx = modes.indexOf(mapViewMode);
    setMapViewMode(modes[(idx + 1) % modes.length]);
  }, [mapViewMode, setMapViewMode]);

  const segmentsRecord = useResearchStore((s) => s.segments);

  const segments: Segment[] = useMemo(
    () => Object.values(segmentsRecord),
    [segmentsRecord],
  );

  const readySegments = useMemo(
    () => segments.filter((s) => s.status === 'ready' || s.status === 'complete' || s.status === 'visual_ready'),
    [segments],
  );

  const currentSegment = currentSegmentId
    ? segmentsRecord[currentSegmentId] ?? null
    : null;

  // ── Caption bridge (voiceStore → playerStore) — energy-gated ─────
  // Captions only appear when audio energy is above threshold,
  // syncing text to actual audible speech instead of Gemini's early transcription.
  const voiceCaption = useVoiceStore((s) => s.caption);
  const setCaption = usePlayerStore((s) => s.setCaption);
  const setCaptionWps = usePlayerStore((s) => s.setCaptionWps);
  const analyserNode = useVoiceStore((s) => s.analyserNode);
  const turnStartRef = useRef<number>(0);
  const turnWordCountRef = useRef<number>(0);
  const captionPendingRef = useRef<string | null>(null);
  const captionRafRef = useRef(0);

  // Buffer incoming captions + track WPS
  useEffect(() => {
    if (!voiceCaption) return;
    captionPendingRef.current = voiceCaption;

    const now = Date.now();
    const wordCount = voiceCaption.trim().split(/\s+/).length;
    if (turnWordCountRef.current === 0 || wordCount < turnWordCountRef.current) {
      turnStartRef.current = now;
      turnWordCountRef.current = wordCount;
    } else {
      turnWordCountRef.current = wordCount;
      const elapsed = (now - turnStartRef.current) / 1000;
      if (elapsed > 0.5 && wordCount > 3) {
        setCaptionWps(wordCount / elapsed);
      }
    }

    // Fallback: no analyser yet — show captions immediately
    if (!useVoiceStore.getState().analyserNode) {
      setCaption(voiceCaption);
      captionPendingRef.current = null;
    }
  }, [voiceCaption, setCaptionWps, setCaption]);

  // rAF loop: only forward caption when audio energy detected
  useEffect(() => {
    if (!analyserNode) return;
    const data = new Uint8Array(analyserNode.frequencyBinCount);

    function checkEnergy() {
      analyserNode!.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const energy = sum / data.length / 255;

      if (energy > 0.02 && captionPendingRef.current) {
        setCaption(captionPendingRef.current);
        captionPendingRef.current = null;
      }
      captionRafRef.current = requestAnimationFrame(checkEnergy);
    }
    captionRafRef.current = requestAnimationFrame(checkEnergy);
    return () => cancelAnimationFrame(captionRafRef.current);
  }, [analyserNode, setCaption]);

  // ── Single-stream narration with pre-timed image changes ──────────
  const beats = usePlayerStore((s) => s.beats);
  const advanceBeat = usePlayerStore((s) => s.advanceBeat);
  const setIsNarrating = usePlayerStore((s) => s.setIsNarrating);
  const isNarrating = usePlayerStore((s) => s.isNarrating);
  const beatAdvanceSignal = usePlayerStore((s) => s.beatAdvanceSignal);
  const setBeatTransitioning = usePlayerStore((s) => s.setBeatTransitioning);
  const addBeat = usePlayerStore((s) => s.addBeat);

  // Track which segment we started narration for
  const narrationStartedRef = useRef<Set<string>>(new Set());
  // Auto-advance timer between segments
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Pre-calculated image change timers (one per beat boundary)
  const imageTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Track previous beatAdvanceSignal for turn_complete detection
  const prevSignalRef = useRef(0);
  // Track which segment's image timers have been started
  const imageTimersStartedRef = useRef<string | null>(null);
  // Interstitial title card state
  const [showInterstitial, setShowInterstitial] = useState(false);
  const [interstitialTitle, setInterstitialTitle] = useState('');
  // End card state
  const [showEndCard, setShowEndCard] = useState(false);

  const loadBeatsForSegment = usePlayerStore((s) => s.loadBeatsForSegment);

  // ── Effect 1: Load pre-generated beats (for image timing) ────────
  useEffect(() => {
    if (!currentSegment || !sessionId) return;
    if (!currentSegment.script || currentSegment.script.length < 50) return;
    if (narrationStartedRef.current.has(currentSegment.id)) return;

    narrationStartedRef.current.add(currentSegment.id);

    // Check if pipeline already generated beats for this segment (beatsMap)
    const mapBeats = usePlayerStore.getState().beatsMap[currentSegment.id];
    if (mapBeats && mapBeats.length > 0) {
      loadBeatsForSegment(currentSegment.id);
      return;
    }

    // Fallback: beats not in map (pipeline incomplete?) — call on-demand endpoint
    const controller = new AbortController();
    startNarration(sessionId, currentSegment.id, controller.signal).catch(() => {
      // Silently fail — fallback timer below will handle it
    });

    return () => controller.abort();
  }, [currentSegment, sessionId, loadBeatsForSegment]);

  // ── Sanitize narration text for Gemini Live API ─────
  const sanitize = useCallback((text: string) =>
    text.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim()
  , []);

  // ── Send one beat at a time (falls back to script if beats not loaded) ─────
  const sendBeatNarration = useCallback((beatIndex: number) => {
    const send = useVoiceStore.getState().sendTextToHistorian;
    const seg = currentSegmentId ? useResearchStore.getState().segments[currentSegmentId] : null;
    if (!send || !seg) return;

    const currentBeats = usePlayerStore.getState().beats;
    const beat = currentBeats[beatIndex];

    let text: string;
    if (beat) {
      const prefix = beatIndex === 0
        ? `You are narrating "${seg.title}". Deliver this naturally — no announcements. `
        : 'Continue narrating the next moment: ';
      text = prefix + sanitize(beat.narrationText);
    } else if (beatIndex === 0 && seg.script) {
      // Beats not loaded yet — send first ~600 chars of script as fallback
      const snippet = sanitize(seg.script).slice(0, 600);
      text = `You are narrating "${seg.title}". Deliver this naturally — no announcements. ${snippet}`;
    } else {
      console.warn('[DocumentaryPlayer] sendBeatNarration: no beat or script for index', beatIndex);
      return;
    }

    console.log(`[DocumentaryPlayer] sendBeatNarration(${beatIndex}): ${text.slice(0, 80)}...`);
    send(text);
  }, [currentSegmentId, sanitize]);

  // ── startImageTimers: pre-calculate image + narration changes based on word count ──
  const startImageTimers = useCallback(() => {
    imageTimersRef.current.forEach(clearTimeout);
    imageTimersRef.current = [];
    const currentBeats = usePlayerStore.getState().beats;
    if (currentBeats.length <= 1) return;

    const MS_PER_WORD = 360; // ~2.8 words/sec narration pace
    let cumulativeMs = 0;

    for (let i = 1; i < currentBeats.length; i++) {
      const beatIdx = i;
      const prevWords = currentBeats[i - 1].narrationText.trim().split(/\s+/).length;
      cumulativeMs += prevWords * MS_PER_WORD;
      const timer = setTimeout(() => {
        setBeatTransitioning(true);
        setTimeout(() => setBeatTransitioning(false), 300);
        advanceBeat();
        // Send next beat's narration text to historian
        sendBeatNarration(beatIdx);
      }, cumulativeMs);
      imageTimersRef.current.push(timer);
    }
  }, [advanceBeat, setBeatTransitioning, sendBeatNarration]);

  // ── Effect 2: Start image timers when narrating and beats are ready ──
  useEffect(() => {
    if (!isNarrating || beats.length <= 1 || !currentSegmentId) return;
    if (imageTimersStartedRef.current === currentSegmentId) return;
    imageTimersStartedRef.current = currentSegmentId;
    startImageTimers();
  }, [isNarrating, beats, currentSegmentId, startImageTimers]);

  // ── Effect 2b: turn_complete handling ──
  // Each beat gets its own turn_complete. On the last beat, end narration.
  useEffect(() => {
    if (beatAdvanceSignal === 0) return;
    if (beatAdvanceSignal === prevSignalRef.current) return;
    prevSignalRef.current = beatAdvanceSignal;

    const currentBeats = usePlayerStore.getState().beats;
    const idx = usePlayerStore.getState().currentBeatIndex;
    const beat = currentBeats[idx];

    // Last beat finished — end narration and clean up timers
    if (!beat || idx >= currentBeats.length - 1) {
      imageTimersRef.current.forEach(clearTimeout);
      imageTimersRef.current = [];
      setIsNarrating(false);
    }
  }, [beatAdvanceSignal, setIsNarrating]);

  // ── Effect 3: Fallback — if no beats arrive in 30s, create synthetic beats ──
  useEffect(() => {
    if (!currentSegment) return;
    if (!currentSegment.script || currentSegment.script.length < 50) return;
    if (beats.length > 0) return;

    const fallbackTimer = setTimeout(() => {
      if (usePlayerStore.getState().beats.length > 0) return;

      // Split script into synthetic beats (3-4 sentences each)
      const sentences = currentSegment.script.match(/[^.!?]+[.!?]+/g) ?? [currentSegment.script];
      const beatsPerChunk = Math.ceil(sentences.length / 4);
      const chunks: string[] = [];
      for (let i = 0; i < sentences.length; i += beatsPerChunk) {
        chunks.push(sentences.slice(i, i + beatsPerChunk).join(' ').trim());
      }

      // Add synthetic beats to beatsMap
      chunks.forEach((text, i) => {
        addBeat({
          segmentId: currentSegment.id,
          beatIndex: i,
          totalBeats: chunks.length,
          narrationText: text,
          imageUrl: null,
          directionText: '',
        });
      });
    }, 30_000);

    return () => clearTimeout(fallbackTimer);
  }, [currentSegment, beats.length, addBeat]);

  // ── Effect 4: Auto-advance between segments ──
  // When narration finishes (isNarrating false after beats played), auto-advance.
  const wasNarratingRef = useRef(false);

  // Track if at least one script was actually sent to historian
  const beatWasSpokenRef = useRef(false);

  useEffect(() => {
    if (isNarrating) {
      wasNarratingRef.current = true;
      setShowEndCard(false);
      return;
    }
    // Only auto-advance if narration actually happened (a beat was sent)
    if (!wasNarratingRef.current || !beatWasSpokenRef.current) return;
    wasNarratingRef.current = false;
    beatWasSpokenRef.current = false;
    if (beats.length === 0) return;

    // Narration just finished — auto-advance after cinematic pause
    clearTimeout(autoAdvanceTimerRef.current);
    autoAdvanceTimerRef.current = setTimeout(() => {
      const idx = readySegments.findIndex((s) => s.id === currentSegmentId);
      const nextSeg = readySegments[idx + 1];

      if (nextSeg) {
        // Show interstitial title card, then advance + auto-narrate
        setInterstitialTitle(nextSeg.title || `Chapter ${idx + 2}`);
        setShowInterstitial(true);
        setTimeout(() => {
          setShowInterstitial(false);
          try {
            if ('startViewTransition' in document) {
              (document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(() => {
                open(nextSeg.id);
              });
            } else {
              open(nextSeg.id);
            }
          } catch {
            open(nextSeg.id);
          }
          // Auto-start narration for next segment (beat 0)
          // Beats load via Effect 1 when currentSegment changes.
          // Use a short delay to let beats load first, then send beat 0.
          setTimeout(() => {
            const nextBeats = usePlayerStore.getState().beats;
            const send = useVoiceStore.getState().sendTextToHistorian;
            if (send && nextBeats.length > 0) {
              const beat = nextBeats[0];
              send(
                `You are narrating "${nextSeg.title}". Deliver this naturally — no announcements. ` +
                sanitize(beat.narrationText)
              );
              setIsNarrating(true);
              beatWasSpokenRef.current = true;
            }
          }, 500);
        }, 2500);
      } else {
        // Last segment — show end card
        setShowEndCard(true);
      }
    }, 3000);

    return () => clearTimeout(autoAdvanceTimerRef.current);
  }, [isNarrating, beats.length, readySegments, currentSegmentId, open]);

  // Reset state when segment changes
  useEffect(() => {
    imageTimersStartedRef.current = null;
    imageTimersRef.current.forEach(clearTimeout);
    imageTimersRef.current = [];
    setShowEndCard(false);
    setShowInterstitial(false);
  }, [currentSegment?.id]);

  const currentIndexInReady = useMemo(() => {
    if (!currentSegmentId) return -1;
    return readySegments.findIndex((s) => s.id === currentSegmentId);
  }, [currentSegmentId, readySegments]);

  const hasPrev = currentIndexInReady > 0;
  const hasNext = currentIndexInReady < readySegments.length - 1;

  // ── Idle timer (auto-hide chrome — 8s first visit, 3s thereafter) ──
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const reset = () => {
      setIdle(false);
      clearTimeout(timerRef.current);
      const delay = !settingsRef.current.hasSeenSegmentControls ? 8000 : 3000;
      timerRef.current = setTimeout(() => {
        setIdle(true);
        if (!settingsRef.current.hasSeenSegmentControls) {
          updateSettingRef.current('hasSeenSegmentControls', true);
        }
      }, delay);
    };

    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('touchstart', reset);
    reset();

    return () => {
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('touchstart', reset);
      clearTimeout(timerRef.current);
    };
  }, [setIdle]);

  // ── Play overlay handler — starts beat-by-beat narration ─────
  const handlePlay = useCallback(() => {
    setShowPlayOverlay(false);
    sendBeatNarration(0);
    setIsNarrating(true);
    beatWasSpokenRef.current = true;
  }, [sendBeatNarration, setIsNarrating]);

  // ── Auto-show keyboard shortcuts on first visit ────────────────
  useEffect(() => {
    if (settingsRef.current.hasSeenPlayerShortcuts) return;
    const showTimer = setTimeout(() => setShortcutsOpen(true), 1500);
    const hideTimer = setTimeout(() => {
      setShortcutsOpen(false);
      updateSettingRef.current('hasSeenPlayerShortcuts', true);
    }, 6500);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Map discovery hint on first visit ──────────────────────────
  useEffect(() => {
    if (settingsRef.current.hasSeenMapDiscovery) return;
    const showTimer = setTimeout(() => setMapDiscoveryVisible(true), 4000);
    const hideTimer = setTimeout(() => {
      setMapDiscoveryVisible(false);
      updateSettingRef.current('hasSeenMapDiscovery', true);
    }, 8000);
    return () => { clearTimeout(showTimer); clearTimeout(hideTimer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Interruption hint on first historian speech ────────────────
  const hasShownInterruptHintRef = useRef(false);

  useEffect(() => {
    if (voiceState !== 'historian_speaking') return;
    if (hasShownInterruptHintRef.current) return;
    hasShownInterruptHintRef.current = true;
    if (settingsRef.current.hasSeenInterruptHint) return;

    const timer = setTimeout(() => {
      toast('Speak anytime to ask a question or redirect the narrative', {
        duration: 6000,
      });
      updateSettingRef.current('hasSeenInterruptHint', true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [voiceState]);

  // ── Illustration toast (connects question to visual change) ────
  const prevIllustrationRef = useRef<string | null>(null);

  useEffect(() => {
    if (!liveIllustration) return;
    if (liveIllustration.imageUrl === prevIllustrationRef.current) return;
    prevIllustrationRef.current = liveIllustration.imageUrl;

    toast(liveIllustration.query ? 'Illustrating your question' : 'Scene illustrated', {
      description: liveIllustration.caption,
      duration: 4000,
    });
  }, [liveIllustration]);

  // ── Segment navigation ───────────────────────────────────────
  const navigateSegment = useCallback(
    (direction: 'prev' | 'next') => {
      const targetIndex =
        direction === 'prev'
          ? currentIndexInReady - 1
          : currentIndexInReady + 1;
      const target = readySegments[targetIndex];
      if (!target) return;

      // Use View Transitions API if available, else instant switch
      if (
        typeof document !== 'undefined' &&
        'startViewTransition' in document
      ) {
        (document as Document & { startViewTransition: (cb: () => void) => void }).startViewTransition(() => {
          open(target.id);
        });
      } else {
        open(target.id);
      }
    },
    [currentIndexInReady, readySegments, open],
  );

  // ── Media Session API (OS-level transport controls) ──────────
  const goNext = useCallback(() => navigateSegment('next'), [navigateSegment]);
  const goPrev = useCallback(() => navigateSegment('prev'), [navigateSegment]);

  // ── Download helpers ─────────────────────────────────────────
  const handleActiveImageChange = useCallback((url: string | null) => {
    activeImageUrlRef.current = url;
  }, []);

  const handleDownloadCurrent = useCallback(() => {
    const url = activeImageUrlRef.current;
    if (!url) return;
    const slug = currentSegment?.title
      ? currentSegment.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
      : 'frame';
    void downloadImage(url, `ai-historian-${slug}.jpg`);
  }, [currentSegment?.title]);

  const handleSaveAll = useCallback(() => {
    const urls = currentSegment?.imageUrls;
    if (!urls || urls.length === 0) return;
    const slug = currentSegment.title
      ? currentSegment.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
      : 'scene';
    startSaveAllTransition(() => {
      void downloadImages(urls, `ai-historian-${slug}`, 500);
    });
  }, [currentSegment?.imageUrls, currentSegment?.title]);

  const handleDownloadVideo = useCallback(() => {
    const videoUrl = currentSegment?.videoUrl;
    if (!videoUrl) return;
    const slug = currentSegment.title
      ? currentSegment.title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
      : 'scene';
    void downloadVideo(videoUrl, `ai-historian-${slug}-video.mp4`);
  }, [currentSegment?.videoUrl, currentSegment?.title]);

  useMediaSession(currentSegment, {
    onNextTrack: hasNext ? goNext : undefined,
    onPreviousTrack: hasPrev ? goPrev : undefined,
  });

  // ── Keyboard navigation ──────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;

      if (e.key === 'ArrowLeft' && hasPrev) {
        navigateSegment('prev');
      } else if (e.key === 'ArrowRight' && hasNext) {
        navigateSegment('next');
      } else if (e.key === 'Escape') {
        if (sidebarOpen) {
          setSidebarOpen(false);
        } else {
          navigate('/workspace');
        }
      } else if (e.key === 'f' || e.key === 'F') {
        if (document.fullscreenEnabled) {
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            document.documentElement.requestFullscreen();
          }
        }
      } else if (e.key === 'm' || e.key === 'M') {
        cycleMapMode();
      } else if (e.key === ' ') {
        e.preventDefault();
        if (voiceState === 'idle') {
          // Beat-by-beat narration — send first beat
          const currentBeats = usePlayerStore.getState().beats;
          if (currentBeats.length > 0) {
            sendBeatNarration(0);
            setIsNarrating(true);
            beatWasSpokenRef.current = true;
            setShowPlayOverlay(false);
          } else {
            const begin = useVoiceStore.getState().beginConsultation;
            if (begin) begin();
          }
        } else if (voiceState === 'listening') {
          setVoiceState('idle');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasPrev, hasNext, navigateSegment, sidebarOpen, navigate, voiceState, setVoiceState, cycleMapMode]);

  // ── Click-outside to close shortcuts tooltip ────────────────
  useEffect(() => {
    if (!shortcutsOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        shortcutsRef.current &&
        !shortcutsRef.current.contains(e.target as Node) &&
        shortcutsBtnRef.current &&
        !shortcutsBtnRef.current.contains(e.target as Node)
      ) {
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [shortcutsOpen]);

  // ── Chrome opacity/transform ─────────────────────────────────
  const chromeStyle = {
    opacity: isIdle ? 0 : 1,
    transition: 'opacity 0.5s ease, transform 0.5s ease',
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden player-root select-none" style={{ background: 'var(--player-bg)' }}>
      {/* Layer 1: Visual stage — Ken Burns / Map / Split */}
      <div className="absolute inset-0 flex">
        {/* Ken Burns panel */}
        <AnimatePresence mode="wait">
          {mapViewMode !== 'map' && (
            <motion.div
              key={`kb-${currentSegmentId ?? 'empty'}`}
              initial={{ opacity: 0, scale: 1.03 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: 'easeInOut' }}
              className="absolute inset-0"
              style={{ width: mapViewMode === 'split' ? '50%' : '100%' }}
            >
              <KenBurnsStage
                segment={currentSegment}
                onActiveImageChange={handleActiveImageChange}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Map panel */}
        <AnimatePresence>
          {mapViewMode !== 'ken-burns' && (
            <motion.div
              key="map-panel"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
              className="absolute top-0 right-0 h-full"
              style={{ width: mapViewMode === 'split' ? '50%' : '100%' }}
            >
              <TimelineMap onPinClick={handlePinClick} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Map onboarding hint */}
      <AnimatePresence>
        {mapViewMode !== 'ken-burns' && !mapHintDismissed && (
          <motion.div
            key="map-hint"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.4, delay: 0.8 }}
            className="absolute bottom-44 left-1/2 -translate-x-1/2 z-20"
            style={{
              background: 'var(--player-surface)',
              border: '1px solid var(--player-border)',
              borderRadius: 10,
              padding: '14px 20px',
              maxWidth: 360,
            }}
          >
            <p style={{ fontFamily: 'var(--font-serif)', fontSize: 15, color: 'var(--glow-primary)', marginBottom: 8 }}>
              Live Time Travel Map
            </p>
            <ul style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--player-text-secondary)', lineHeight: 1.8, paddingLeft: 14, margin: 0 }}>
              <li><strong style={{ color: 'var(--glow-primary)' }}>M</strong> — cycle view: visuals / split / map</li>
              <li><strong style={{ color: 'var(--glow-primary)' }}>&larr; &rarr;</strong> — switch segments (map flies to new region)</li>
              <li><strong style={{ color: 'var(--glow-primary)' }}>Hover pins</strong> — see location name + era</li>
              <li><strong style={{ color: 'var(--glow-primary)' }}>Click a pin</strong> — ask the historian about that place</li>
            </ul>
            <button
              onClick={() => setMapHintDismissed(true)}
              style={{
                marginTop: 10,
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--muted)',
                background: 'transparent',
                border: '1px solid var(--player-border)',
                borderRadius: 4,
                padding: '4px 12px',
                cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layer 1.3: Cinematic play overlay — starts documentary */}
      <AnimatePresence>
        {showPlayOverlay && currentSegment && (
          <motion.div
            key="play-overlay"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center cursor-pointer"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0.6) 100%)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            onClick={handlePlay}
          >
            {/* Play button ring */}
            <motion.div
              className="flex items-center justify-center rounded-full"
              style={{
                width: 80,
                height: 80,
                border: '2px solid rgba(232,221,208,0.6)',
                background: 'rgba(0,0,0,0.3)',
                backdropFilter: 'blur(8px)',
              }}
              whileHover={{ scale: 1.1, borderColor: 'rgba(196,149,106,0.8)' }}
              whileTap={{ scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 17 }}
            >
              <svg width="28" height="32" viewBox="0 0 28 32" fill="none">
                <path d="M4 2L26 16L4 30V2Z" fill="rgba(232,221,208,0.9)" />
              </svg>
            </motion.div>

            {/* Segment title */}
            <motion.p
              className="mt-6 text-center"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 22,
                fontWeight: 400,
                color: 'rgba(232,221,208,0.9)',
                textShadow: '0 2px 20px rgba(0,0,0,0.8)',
                letterSpacing: '0.03em',
              }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.5 }}
            >
              {currentSegment.title}
            </motion.p>

            {/* Hint text */}
            <motion.p
              className="mt-3"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 10,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'rgba(232,221,208,0.5)',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6, duration: 0.4 }}
            >
              Click to begin narration
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layer 1.4: Segment interstitial title card */}
      <AnimatePresence>
        {showInterstitial && (
          <motion.div
            key="interstitial"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.75)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <motion.div
              style={{
                width: '40%',
                height: 1,
                background: 'var(--glow-primary)',
                marginBottom: 24,
              }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
            <motion.p
              style={{
                fontFamily: 'var(--font-serif)',
                fontWeight: 300,
                fontStyle: 'italic',
                fontSize: 28,
                color: 'rgba(232,221,208,0.9)',
                textShadow: '0 2px 20px rgba(0,0,0,0.8)',
                letterSpacing: '0.03em',
                textAlign: 'center',
                maxWidth: 600,
              }}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.6, type: 'spring', stiffness: 100, damping: 20 }}
            >
              {interstitialTitle}
            </motion.p>
            <motion.div
              style={{
                width: '40%',
                height: 1,
                background: 'var(--glow-primary)',
                marginTop: 24,
              }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1, ease: 'easeOut', delay: 0.2 }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layer 1.45: End card */}
      <AnimatePresence>
        {showEndCard && (
          <motion.div
            key="end-card"
            className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6"
            style={{ background: 'rgba(0,0,0,0.8)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            <motion.div
              style={{
                width: '30%',
                height: 1,
                background: 'var(--glow-primary)',
              }}
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
            />
            <motion.p
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: 10,
                letterSpacing: '0.4em',
                textTransform: 'uppercase',
                color: 'var(--glow-primary)',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.6 }}
            >
              Documentary Complete
            </motion.p>
            <motion.p
              style={{
                fontFamily: 'var(--font-serif)',
                fontWeight: 300,
                fontStyle: 'italic',
                fontSize: 24,
                color: 'rgba(232,221,208,0.85)',
                textShadow: '0 2px 20px rgba(0,0,0,0.6)',
                textAlign: 'center',
                maxWidth: 500,
              }}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7, duration: 0.6 }}
            >
              {readySegments.length} chapter{readySegments.length !== 1 ? 's' : ''} narrated
            </motion.p>
            <motion.button
              onClick={() => navigate('/workspace')}
              style={{
                marginTop: 16,
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--glow-primary)',
                background: 'transparent',
                border: '1px solid rgba(196,149,106,0.4)',
                borderRadius: 6,
                padding: '10px 24px',
                cursor: 'pointer',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1, duration: 0.4 }}
              whileHover={{ scale: 1.04, borderColor: 'rgba(196,149,106,0.7)' }}
              whileTap={{ scale: 0.97 }}
            >
              Return to Workspace
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layer 1.5: Conversation mode — Historian avatar overlay */}
      <AnimatePresence>
        {isConversationMode && (
          <motion.div
            key="conversation-avatar"
            className="absolute inset-0 z-[5] flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8, ease: 'easeInOut' }}
            style={{
              background: `radial-gradient(circle at center, color-mix(in srgb, var(--player-bg) 85%, transparent) 0%, color-mix(in srgb, var(--player-bg) 95%, transparent) 70%)`,
            }}
          >
            <LivingPortrait
              size={400}
              active={true}
              era={currentSegment ? resolveEra(currentSegment) : 'default'}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layer 2: Top bar */}
      <div
        className="absolute top-0 left-0 right-0 z-10 archival-frame"
        style={chromeStyle}
      >
        <div
          className="flex items-center justify-between px-8 py-5"
          style={{
            background:
              'linear-gradient(to bottom, var(--player-overlay) 0%, transparent 100%)',
          }}
        >
          {/* Left: Back button */}
          <div className="flex items-center gap-3 min-w-[80px]">
            <button
              onClick={() => navigate('/workspace')}
              className="p-2 rounded transition-colors duration-200"
              style={{
                color: 'var(--player-text-secondary)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--player-text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--player-text-secondary)';
              }}
              aria-label="Back to workspace"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 4L6 8L10 12" />
              </svg>
            </button>
          </div>

          {/* Center: Logo */}
          <span
            className="flex items-center gap-2"
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: 10,
              letterSpacing: '0.5em',
              textTransform: 'uppercase',
              color: 'var(--glow-primary)',
            }}
          >
            <img src="/logo.png" alt="AI Historian" className="h-5 w-auto brightness-90" />
            AI Historian
          </span>

          {/* Illustration badge — "AI Illustrated" label */}
          <AnimatePresence>
            {liveIllustration && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                style={{
                  position: 'absolute',
                  top: 20,
                  right: 80,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 4,
                  zIndex: 20,
                }}
              >
                <span
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 400,
                    fontSize: 10,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase' as const,
                    color: 'var(--gold)',
                  }}
                >
                  &#10022; AI Illustrated
                </span>
                {liveIllustration.caption && (
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontWeight: 400,
                      fontSize: 11,
                      color: 'rgba(196, 149, 106, 0.65)',
                      maxWidth: 260,
                      textAlign: 'right',
                      lineHeight: 1.4,
                    }}
                  >
                    {liveIllustration.caption}
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Right: Controls */}
          <div className="flex items-center gap-4 min-w-[80px] justify-end">
            {/* Segment index */}
            {readySegments.length > 0 && (
              <span
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 11,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: 'var(--player-text-dim)',
                }}
              >
                {currentIndexInReady >= 0 ? currentIndexInReady + 1 : '-'}
                {' / '}
                {readySegments.length}
              </span>
            )}

            {/* Map view toggle */}
            <div className="relative">
              <button
                onClick={() => {
                  cycleMapMode();
                  if (mapDiscoveryVisible) {
                    setMapDiscoveryVisible(false);
                    updateSetting('hasSeenMapDiscovery', true);
                  }
                }}
                className={`p-2 rounded transition-colors duration-200${mapDiscoveryVisible ? ' globe-pulse' : ''}`}
                style={{
                  color: mapViewMode !== 'ken-burns'
                    ? 'var(--glow-primary)'
                    : 'var(--player-text-secondary)',
                  background: mapViewMode !== 'ken-burns'
                    ? 'rgba(196,149,106,0.15)'
                    : 'transparent',
                  border: mapViewMode !== 'ken-burns'
                    ? '1px solid var(--player-border)'
                    : '1px solid transparent',
                  borderRadius: 6,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                aria-label={`Map view: ${mapViewMode}`}
                title={`Map: ${mapViewMode === 'ken-burns' ? 'off' : mapViewMode} (M)`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {/* Globe/map icon */}
                  <circle cx="8" cy="8" r="6" />
                  <path d="M2 8h12" />
                  <path d="M8 2c-2 2-2 4 0 6s2 4 0 6" />
                </svg>
              </button>
              <AnimatePresence>
                {mapDiscoveryVisible && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.3 }}
                    className="absolute top-full mt-2 right-0 z-50"
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 10,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: 'var(--glow-primary)',
                      whiteSpace: 'nowrap',
                      background: 'var(--player-surface)',
                      border: '1px solid var(--player-border)',
                      borderRadius: 6,
                      padding: '6px 10px',
                    }}
                  >
                    Map available <span style={{ color: 'var(--muted)' }}>(M)</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Shortcuts hint */}
            <div className="relative">
              <button
                ref={shortcutsBtnRef}
                onClick={() => setShortcutsOpen((o) => !o)}
                className="p-2 rounded transition-colors duration-200"
                style={{
                  color: 'var(--player-text-secondary)',
                  background: 'transparent',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 13,
                  lineHeight: 1,
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Keyboard shortcuts"
              >
                ?
              </button>
              {shortcutsOpen && (
                <div
                  ref={shortcutsRef}
                  className="absolute top-full right-0 mt-2 rounded-lg p-3 z-50"
                  style={{
                    background: 'var(--player-surface)',
                    border: '1px solid var(--player-border)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: 11,
                    color: 'var(--player-text-secondary)',
                    whiteSpace: 'pre',
                    lineHeight: 1.8,
                    minWidth: 200,
                  }}
                >
                  {'← →   Previous / Next chapter\n'}
                  {'Space  Toggle voice\n'}
                  {'M      Cycle map view\n'}
                  {'F      Fullscreen\n'}
                  {'Esc    Back to workspace'}
                </div>
              )}
            </div>

            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="p-2 rounded transition-colors duration-200"
              style={{
                color: 'var(--player-text-secondary)',
                background: 'transparent',
              }}
              aria-label="Toggle segment sidebar"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="3" y1="4" x2="15" y2="4" />
                <line x1="3" y1="9" x2="15" y2="9" />
                <line x1="3" y1="14" x2="15" y2="14" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Layer 3: Captions — always visible */}
      <div className="absolute bottom-24 left-0 right-0 flex justify-center z-10 pointer-events-none">
        <CaptionTrack />
      </div>

      {/* Layer 3b: Illustration caption */}
      <AnimatePresence>
        {liveIllustration?.caption && (
          <motion.div
            key="illustration-caption"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 0.85, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute bottom-16 left-0 right-0 flex justify-center z-10 pointer-events-none"
          >
            <p
              className="text-center"
              style={{
                maxWidth: 700,
                fontFamily: 'var(--font-serif)',
                fontWeight: 300,
                fontStyle: 'italic',
                fontSize: 16,
                letterSpacing: '0.03em',
                color: 'var(--gold)',
                textShadow: 'var(--player-illustration-shadow)',
              }}
            >
              {liveIllustration.caption}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layer 4: Bottom bar */}
      <div
        className="absolute bottom-0 left-0 right-0 z-10"
        style={{
          ...chromeStyle,
          transform: isIdle ? 'translateY(20px)' : 'translateY(0)',
        }}
      >
        <div
          className="flex items-center justify-between pl-8 pr-20 py-5"
          style={{
            background:
              'linear-gradient(to top, var(--player-overlay) 0%, transparent 100%)',
          }}
        >
          {/* Prev */}
          <button
            onClick={() => navigateSegment('prev')}
            disabled={!hasPrev}
            className="flex items-center gap-2 transition-opacity duration-200"
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 400,
              fontSize: 11,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: hasPrev ? 'var(--player-text-secondary)' : 'var(--player-text-disabled)',
              cursor: hasPrev ? 'pointer' : 'default',
              background: 'transparent',
              border: 'none',
            }}
            aria-label="Previous segment"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 2L4 7L9 12" />
            </svg>
            Prev
          </button>

          {/* Current segment title */}
          <span
            className="text-center max-w-md truncate"
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 400,
              fontSize: 14,
              color: 'var(--player-text-secondary)',
            }}
          >
            {currentSegment?.title ?? ''}
          </span>

          <div className="flex items-center gap-4">
            {/* Next */}
            <button
              onClick={() => navigateSegment('next')}
              disabled={!hasNext}
              className="flex items-center gap-2 transition-opacity duration-200"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: 11,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: hasNext ? 'var(--player-text-secondary)' : 'var(--player-text-disabled)',
                cursor: hasNext ? 'pointer' : 'default',
                background: 'transparent',
                border: 'none',
              }}
              aria-label="Next segment"
            >
              Next
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 2L10 7L5 12" />
              </svg>
            </button>

            {/* Segments button */}
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="flex items-center gap-2 transition-opacity duration-200"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 400,
                fontSize: 11,
                letterSpacing: '0.15em',
                textTransform: 'uppercase',
                color: 'var(--player-text-dim)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              aria-label="Open segments panel"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <line x1="2" y1="3" x2="12" y2="3" />
                <line x1="2" y1="7" x2="12" y2="7" />
                <line x1="2" y1="11" x2="12" y2="11" />
              </svg>
              Segments
            </button>

            {/* Download current image */}
            {(currentSegment?.imageUrls?.length ?? 0) > 0 && (
              <button
                onClick={handleDownloadCurrent}
                title="Download image"
                aria-label="Download current image"
                className="flex items-center justify-center transition-colors duration-200"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  border: '1px solid rgba(196,149,106,0.25)',
                  background: 'rgba(196,149,106,0.10)',
                  color: 'var(--glow-primary)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(196,149,106,0.22)';
                  e.currentTarget.style.borderColor = 'rgba(196,149,106,0.55)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(196,149,106,0.10)';
                  e.currentTarget.style.borderColor = 'rgba(196,149,106,0.25)';
                }}
              >
                {/* Download-arrow icon */}
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6.5 1v8M3.5 6.5l3 2.5 3-2.5" />
                  <path d="M1.5 11.5h10" />
                </svg>
              </button>
            )}

            {/* Save all images */}
            {(currentSegment?.imageUrls?.length ?? 0) > 1 && (
              <button
                onClick={handleSaveAll}
                disabled={isSavingAll}
                title={
                  isSavingAll
                    ? 'Saving…'
                    : `Save all ${currentSegment!.imageUrls.length} images`
                }
                aria-label="Save all images"
                className="flex items-center gap-1.5 transition-colors duration-200"
                style={{
                  height: 30,
                  padding: '0 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(196,149,106,0.25)',
                  background: isSavingAll
                    ? 'rgba(196,149,106,0.18)'
                    : 'rgba(196,149,106,0.10)',
                  color: isSavingAll
                    ? 'rgba(196,149,106,0.55)'
                    : 'var(--glow-primary)',
                  cursor: isSavingAll ? 'default' : 'pointer',
                  fontFamily: 'var(--font-sans)',
                  fontWeight: 400,
                  fontSize: 10,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (isSavingAll) return;
                  e.currentTarget.style.background = 'rgba(196,149,106,0.22)';
                  e.currentTarget.style.borderColor = 'rgba(196,149,106,0.55)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isSavingAll
                    ? 'rgba(196,149,106,0.18)'
                    : 'rgba(196,149,106,0.10)';
                  e.currentTarget.style.borderColor = 'rgba(196,149,106,0.25)';
                }}
              >
                {isSavingAll ? (
                  <>
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 11 11"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M5.5 1v3M8.5 2.5l-2 2M10 5.5H7M8.5 8.5l-2-2M5.5 10V7M2.5 8.5l2-2M1 5.5h3M2.5 2.5l2 2" />
                    </svg>
                    Saving
                  </>
                ) : (
                  <>
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 11 11"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="1" y="1" width="9" height="9" rx="1.5" />
                      <path d="M3.5 6l2 2 2-2" />
                      <path d="M5.5 3v5" />
                    </svg>
                    Save all
                  </>
                )}
              </button>
            )}

            {/* Download video */}
            {currentSegment?.videoUrl && (
              <button
                onClick={handleDownloadVideo}
                title="Download video"
                aria-label="Download video"
                className="flex items-center justify-center transition-colors duration-200"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 6,
                  border: '1px solid rgba(196,149,106,0.25)',
                  background: 'rgba(196,149,106,0.10)',
                  color: 'var(--glow-primary)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(196,149,106,0.22)';
                  e.currentTarget.style.borderColor = 'rgba(196,149,106,0.55)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(196,149,106,0.10)';
                  e.currentTarget.style.borderColor = 'rgba(196,149,106,0.25)';
                }}
              >
                {/* Film/video download icon */}
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="1.5" y="2.5" width="10" height="8" rx="1.5" />
                  <path d="M5 5.5l3 1.5-3 1.5z" fill="currentColor" stroke="none" />
                </svg>
              </button>
            )}

            <ShareButton sessionId={sessionId} segmentId={currentSegmentId} />
          </div>
        </div>
      </div>

      {/* Layer 4.5: Research PiP — visible while pipeline is still running */}
      <AnimatePresence>
        {!pipelineComplete && (
          <motion.div
            key="research-pip"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: isIdle ? 0 : 1, y: isIdle ? 20 : 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="fixed bottom-24 left-6"
            style={{ zIndex: 15, pointerEvents: isIdle ? 'none' : 'auto' }}
          >
            <div
              style={{
                background: 'rgba(26, 21, 16, 0.85)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                borderRadius: 10,
                border: '1px solid rgba(196, 149, 106, 0.12)',
                overflow: 'hidden',
              }}
            >
              {/* Toggle header — always visible */}
              <button
                onClick={() => setPipCollapsed((c) => !c)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: pipCollapsed ? '8px 14px' : '10px 14px 6px',
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'rgba(196, 149, 106, 0.7)',
                }}
                aria-label={pipCollapsed ? 'Expand research panel' : 'Collapse research panel'}
              >
                {/* Animated pulse dot */}
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: 'var(--gold)',
                    flexShrink: 0,
                    animation: 'pulse 2s ease-in-out infinite',
                  }}
                />
                <span
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontWeight: 400,
                    fontSize: 10,
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase',
                  }}
                >
                  Generating
                </span>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    marginLeft: 'auto',
                    transform: pipCollapsed ? 'rotate(180deg)' : 'rotate(0deg)',
                    transition: 'transform 0.25s ease',
                  }}
                >
                  <path d="M2 6.5L5 3.5L8 6.5" />
                </svg>
              </button>

              {/* Expandable content */}
              <AnimatePresence>
                {!pipCollapsed && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: 'easeInOut' }}
                    style={{ overflow: 'hidden' }}
                  >
                    <div
                      style={{
                        padding: '4px 14px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      {/* Current phase */}
                      <PipelinePhaseLabel />

                      {/* Stats row */}
                      <div
                        style={{
                          display: 'flex',
                          gap: 16,
                          fontFamily: 'var(--font-sans)',
                          fontSize: 10,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: 'rgba(196, 149, 106, 0.5)',
                        }}
                      >
                        <PipelineStats />
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Layer 5: Sidebar */}
      <PlayerSidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
    </div>
  );
}
