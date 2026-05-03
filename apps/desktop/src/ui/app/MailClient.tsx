import { useQuery } from '@tanstack/react-query';
import { authSessionQueryOptions } from '../../lib/mail/mail-query-options';
import { AuthenticatedMailClient } from './AuthenticatedMailClient';
import { FullScreenStatus } from './StatusViews';
import { Onboarding } from './Onboarding';

export function MailClient() {
  const sessionQuery = useQuery(authSessionQueryOptions());

  if (sessionQuery.isPending) {
    return <FullScreenStatus label="Checking mail sessions..." />;
  }

  if (sessionQuery.isError) {
    return (
      <Onboarding
        session={{
          status: 'configuration-error',
          message: sessionQuery.error.message,
          accounts: [],
          providers: [],
        }}
      />
    );
  }

  if (sessionQuery.data.status !== 'authenticated') {
    return <Onboarding session={sessionQuery.data} />;
  }

  return <AuthenticatedMailClient session={sessionQuery.data} />;
}
