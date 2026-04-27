import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { AuthenticatedMailClient } from './AuthenticatedMailClient';
import { FullScreenStatus } from './StatusViews';
import { Onboarding } from './Onboarding';

export function MailClient() {
  const sessionQuery = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: api.auth.getSession,
  });

  if (sessionQuery.isPending) {
    return <FullScreenStatus label="Checking Microsoft session..." />;
  }

  if (sessionQuery.isError) {
    return (
      <Onboarding
        session={{
          status: 'configuration-error',
          message: sessionQuery.error.message,
        }}
      />
    );
  }

  if (sessionQuery.data.status !== 'authenticated') {
    return <Onboarding session={sessionQuery.data} />;
  }

  return <AuthenticatedMailClient session={sessionQuery.data} />;
}
