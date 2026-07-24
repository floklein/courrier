import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api-client';
import { emptyComposeWindowDraft } from '@/lib/compose-window';
import { requestComposeWindowClose } from '@/ui/app/compose-window-close';
import { MailComposer } from '@/ui/compose/MailComposer';
import { FullScreenStatus } from '@/ui/app/StatusViews';

export function ComposeWindow() {
  const queryClient = useQueryClient();
  const composerRootRef = useRef<HTMLElement>(null);
  const draftQuery = useQuery({
    queryKey: ['window', 'compose-draft'],
    queryFn: api.window.getComposeDraft,
  });
  useEffect(() => {
    if (draftQuery.isPending) {
      return undefined;
    }

    return api.window.onCloseRequested(() => {
      requestComposeWindowClose(composerRootRef.current);
    });
  }, [draftQuery.isPending]);

  if (draftQuery.isPending) {
    return <FullScreenStatus label="Opening composer..." />;
  }

  return (
    <main ref={composerRootRef} className="h-full bg-background">
      <MailComposer
        accountId={draftQuery.data?.accountId ?? emptyComposeWindowDraft.accountId}
        mode={draftQuery.data?.kind ?? 'new'}
        initialDraft={draftQuery.data ?? emptyComposeWindowDraft}
        isSending={false}
        error={null}
        className="h-full"
        onClose={() => {
          void api.window.closeCurrent();
        }}
        onProviderDraftChanged={() =>
          Promise.all([
            queryClient.invalidateQueries({
              queryKey: [
                'mail',
                draftQuery.data?.accountId ?? emptyComposeWindowDraft.accountId,
                'folders',
              ],
            }),
            queryClient.invalidateQueries({
              queryKey: [
                'mail',
                draftQuery.data?.accountId ?? emptyComposeWindowDraft.accountId,
                'messages',
              ],
            }),
            queryClient.invalidateQueries({
              queryKey: [
                'mail',
                draftQuery.data?.accountId ?? emptyComposeWindowDraft.accountId,
                'drafts',
              ],
            }),
          ]).then(() => undefined)
        }
        useWindowHeader
      />
    </main>
  );
}
