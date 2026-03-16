import { useParams, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useSessionStore } from '../store/sessionStore';
import { useResearchStore } from '../store/researchStore';
import { DocumentaryPlayer } from '../components/player';
import { getSegments } from '../services/api';

export function PlayerPage() {
  const { segmentId } = useParams<{ segmentId: string }>();
  const navigate = useNavigate();
  const sessionId = useSessionStore((s) => s.sessionId);
  const open = usePlayerStore((s) => s.open);

  useEffect(() => {
    if (!sessionId) {
      navigate('/');
      return;
    }
    if (segmentId) {
      open(segmentId);
    }
  }, [sessionId, segmentId, open, navigate]);

  // If research store was wiped when WorkspacePage unmounted, re-fetch segments.
  // Also re-fetch when the specific segment being opened is not in the store yet.
  useEffect(() => {
    if (!sessionId) return;
    const { segments, setSegment } = useResearchStore.getState();
    const storeEmpty = Object.keys(segments).length === 0;
    const segmentMissing = segmentId != null && segments[segmentId] == null;
    const segmentHasNoImages = segmentId != null && segments[segmentId] != null && (segments[segmentId].imageUrls?.length ?? 0) === 0;
    if (!storeEmpty && !segmentMissing && !segmentHasNoImages) return;

    const controller = new AbortController();
    getSegments(sessionId, controller.signal)
      .then((segs) => {
        const { setSegmentGeo } = usePlayerStore.getState();
        for (const seg of segs) {
          setSegment(seg.id, seg);
          if (seg.geo) setSegmentGeo(seg.id, seg.geo);
        }
      })
      .catch((err) => { if (err instanceof Error && err.name !== 'AbortError') console.warn(err); });

    return () => controller.abort();
  }, [sessionId, segmentId]);

  return <DocumentaryPlayer />;
}
