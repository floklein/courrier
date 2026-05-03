import type { QueryClient } from '@tanstack/react-query';
import type { MailRemoteChangeEvent } from '@courrier/mail-contracts';

export async function invalidateRemoteMailUpdate(
  queryClient: QueryClient,
  event: MailRemoteChangeEvent,
) {
  const mailQueryKey = event.accountId ? ['mail', event.accountId] : ['mail'];

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: [...mailQueryKey, 'folders'] }),
    queryClient.invalidateQueries({ queryKey: [...mailQueryKey, 'messages'] }),
    event.kind === 'lifecycle' || event.messageId
      ? queryClient.invalidateQueries({ queryKey: [...mailQueryKey, 'message'] })
      : Promise.resolve(),
  ]);
}
