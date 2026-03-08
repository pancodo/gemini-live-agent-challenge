import { useParams, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { usePlayerStore } from '../store/playerStore';
import { useSessionStore } from '../store/sessionStore';
import { DocumentaryPlayer } from '../components/player';

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

  return <DocumentaryPlayer />;
}
