import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { resetMailRouteAfterActiveAccountChanged } from '@/lib/mail/mail-route-navigation';
import type { AuthSession } from '@/lib/mail-types';
import { useComposeStore } from '@/hooks/compose-store';

export function useActiveMailAccountChange() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const resetActiveMailView = useCallback(async () => {
    useComposeStore.getState().close();
    await resetMailRouteAfterActiveAccountChanged(navigate);
  }, [navigate]);

  const resetActiveMailState = useCallback(async () => {
    await resetActiveMailView();
    queryClient.removeQueries({ queryKey: ['mail'] });
  }, [queryClient, resetActiveMailView]);

  const resetSignedOutMailAccountState = useCallback(
    async (accountId: string) => {
      await resetActiveMailView();
      queryClient.removeQueries({ queryKey: ['mail', accountId] });
    },
    [queryClient, resetActiveMailView],
  );

  const prepareActiveMailAccountChange = useCallback(async () => {
    await resetActiveMailView();
  }, [resetActiveMailView]);

  const applyActiveMailAccountSession = useCallback(
    async (session: AuthSession) => {
      queryClient.setQueryData(['auth', 'session'], session);
      await resetActiveMailView();
    },
    [queryClient, resetActiveMailView],
  );

  const invalidateMailState = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['mail'] }),
    [queryClient],
  );

  return {
    applyActiveMailAccountSession,
    invalidateMailState,
    prepareActiveMailAccountChange,
    queryClient,
    resetActiveMailState,
    resetSignedOutMailAccountState,
  };
}
