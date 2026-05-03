import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { emptyComposeWindowDraft } from '../../lib/compose-window';
import type { SendMailInput } from '../../lib/mail-types';
import { MailComposer } from '../compose/MailComposer';
import { FullScreenStatus } from './StatusViews';

export function ComposeWindow() {
  const draftQuery = useQuery({
    queryKey: ['window', 'compose-draft'],
    queryFn: api.window.getComposeDraft,
  });
  const sendMessageMutation = useMutation({
    mutationFn: (input: SendMailInput) =>
      api.mail.sendMessage(
        draftQuery.data?.accountId ?? emptyComposeWindowDraft.accountId,
        input,
      ),
    onSuccess: async () => {
      await api.window.closeCurrent();
    },
  });

  if (draftQuery.isPending) {
    return <FullScreenStatus label="Opening composer..." />;
  }

  return (
    <main className="h-full bg-background">
      <MailComposer
        accountId={draftQuery.data?.accountId ?? emptyComposeWindowDraft.accountId}
        mode="new"
        initialDraft={draftQuery.data ?? emptyComposeWindowDraft}
        isSending={sendMessageMutation.isPending}
        error={sendMessageMutation.error as Error | null}
        className="h-full"
        onClose={() => {
          void api.window.closeCurrent();
        }}
        onReply={() => undefined}
        onSend={(input) => sendMessageMutation.mutate(input)}
        useWindowHeader
      />
    </main>
  );
}
