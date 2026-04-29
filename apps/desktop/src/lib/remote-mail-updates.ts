import type { QueryClient } from '@tanstack/react-query';
import type { MailRemoteChangeEvent } from '@courrier/mail-contracts';

export async function invalidateRemoteMailUpdate(
  queryClient: QueryClient,
  event: MailRemoteChangeEvent,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['mail', 'folders'] }),
    queryClient.invalidateQueries({ queryKey: ['mail', 'messages'] }),
    event.messageId
      ? queryClient.invalidateQueries({ queryKey: ['mail', 'message'] })
      : Promise.resolve(),
  ]);
}
