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
    enabled: !!sessionId && (status === 'processing' || status === 'uploading'),
    refetchInterval: 3000,
  });

  useEffect(() => {
    if (query.data) {
      setSession({
        status: query.data.status,
        language: query.data.language,
        visualBible: query.data.visualBible,
        documentUrl: query.data.documentUrl ?? null,
      });
    }
  }, [query.data, setSession]);

  return { isLoading: query.isLoading, error: query.error };
}
