import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSessionStatus } from '../services/api';
import { useSessionStore } from '../store/sessionStore';

export function useSession(sessionId: string | null) {
  const setSession = useSessionStore((s) => s.setSession);

  const query = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSessionStatus(sessionId!),
    // Always fetch when sessionId exists — needed for session recovery after page refresh.
    // Poll continuously while pipeline is running; single fetch otherwise.
    enabled: !!sessionId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'processing' || s === 'uploading' ? 3000 : false;
    },
    select: (data) => ({
      status: data.status,
      language: data.language,
      visualBible: data.visualBible,
      documentUrl: data.documentUrl ?? null,
    }),
  });

  useEffect(() => {
    if (query.data) {
      setSession({
        status: query.data.status,
        language: query.data.language,
        visualBible: query.data.visualBible,
        documentUrl: query.data.documentUrl,
      });
    }
  }, [query.data, setSession]);

  return { isLoading: query.isLoading, error: query.error };
}
