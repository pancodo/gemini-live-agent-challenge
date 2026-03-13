import { useCallback } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { useVoiceStore } from '../../store/voiceStore';
import { useNavigate } from 'react-router-dom';

/**
 * Specialized toast that appears after the historian finishes speaking
 * following an interruption, offering to resume documentary playback
 * from the point where it was interrupted.
 *
 * Usage:
 *   const { showResumeToast } = useResumeToast();
 *   // Call after historian finishes answering the user's question
 *   showResumeToast();
 */
export function useResumeToast() {
  const { resumeSegmentId, clearResume } = useVoiceStore(
    useShallow((s) => ({ resumeSegmentId: s.resumeSegmentId, clearResume: s.clearResume })),
  );
  const navigate = useNavigate();

  const showResumeToast = useCallback(() => {
    if (!resumeSegmentId) return;

    toast('Continue from where we left off?', {
      action: {
        label: 'Resume',
        onClick: () => {
          navigate(`/player/${resumeSegmentId}`);
          clearResume();
        },
      },
      duration: 8000,
    });
  }, [resumeSegmentId, clearResume, navigate]);

  return { showResumeToast } as const;
}
