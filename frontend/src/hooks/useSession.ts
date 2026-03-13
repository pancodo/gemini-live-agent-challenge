import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSessionStatus } from '../services/api';
import { useSessionStore } from '../store/sessionStore';

export function useSession(sessionId: string | null) {
  const setSession = useSessionStore((s) => s.setSession);
  const status = useSessionStore((s) => s.status);

  const query = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSessionStatus(sessionId!),
    // Always fetch when sessionId exists — needed for session recovery after page refresh.
    // Poll continuously while pipeline is running; single fetch otherwise.
    enabled: !!sessionId && !sessionId.startsWith('dev-'),
    refetchInterval: status === 'processing' || status === 'uploading' ? 3000 : false,
  });

  useEffect(() => {
    if (query.data) {
      // Only update documentUrl if we don't have one yet — avoid re-rendering
      // the PDF viewer every poll cycle with a fresh signed URL.
      const currentDocUrl = useSessionStore.getState().documentUrl;
      setSession({
        status: query.data.status,
        language: query.data.language,
        visualBible: query.data.visualBible,
        ...(currentDocUrl ? {} : { documentUrl: query.data.documentUrl ?? null }),
      });
    }
  }, [query.data, setSession]);

  return { isLoading: query.isLoading, error: query.error };
}
