import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { resetMailRouteAfterActiveAccountChanged } from '../lib/mail/mail-route-navigation';
import type { AuthSession } from '../lib/mail-types';
import { useComposeStore } from './compose-store';

export function useActiveMailAccountChange() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const resetActiveMailState = useCallback(() => {
    useComposeStore.getState().close();
    resetMailRouteAfterActiveAccountChanged(navigate);
    queryClient.removeQueries({ queryKey: ['mail'] });
  }, [navigate, queryClient]);

  const prepareActiveMailAccountChange = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: ['mail'] });
    resetActiveMailState();
  }, [queryClient, resetActiveMailState]);

  const applyActiveMailAccountSession = useCallback(
    (session: AuthSession) => {
      resetActiveMailState();
      queryClient.setQueryData(['auth', 'session'], session);
    },
    [queryClient, resetActiveMailState],
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
  };
}
