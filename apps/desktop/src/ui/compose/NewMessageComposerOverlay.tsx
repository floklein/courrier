import { PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useComposeStore } from '@/hooks/compose-store';
import type { ComposeWindowDraft } from '@/lib/compose-window';
import { cn } from '@/lib/utils';
import { MailComposer } from '@/ui/compose/MailComposer';

export function NewMessageComposerOverlay({
  accountId,
  isSending,
  error,
  onClose,
  onMoveToWindow,
  onProviderDraftChanged,
}: {
  accountId: string;
  isSending: boolean;
  error: Error | null;
  onClose: () => void;
  onMoveToWindow: (draft: ComposeWindowDraft) => Promise<void> | void;
  onProviderDraftChanged?: () => Promise<void> | void;
}) {
  const draft = useComposeStore((state) => state.draft);
  const isMinimized = useComposeStore((state) => state.isMinimized);
  const setDraft = useComposeStore((state) => state.setDraft);
  const setFlushHandler = useComposeStore((state) => state.setFlushHandler);
  const setMinimized = useComposeStore((state) => state.setMinimized);
  const minimizedTitle = draft.subject.trim() || 'New message';

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex items-end justify-end max-sm:inset-x-2">
      <div
        role="dialog"
        aria-label="New message"
        className={cn(
          'pointer-events-auto w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-lg border bg-card shadow-2xl max-sm:w-full',
          isMinimized && 'hidden',
        )}
      >
        <MailComposer
          key={draft.providerDraftId ?? `${draft.accountId}:${draft.kind ?? 'new'}`}
          accountId={accountId}
          mode={draft.kind ?? 'new'}
          initialDraft={draft}
          isSending={isSending}
          error={error}
          className="h-[min(640px,calc(100vh-6rem))]"
          onClose={onClose}
          onDraftChange={setDraft}
          onFlushHandlerChange={setFlushHandler}
          onMinimize={() => setMinimized(true)}
          onMoveToWindow={onMoveToWindow}
          onProviderDraftChanged={onProviderDraftChanged}
        />
      </div>
      {isMinimized && (
        <div className="pointer-events-none flex w-full justify-end">
          <Button
            type="button"
            variant="outline"
            className="pointer-events-auto h-11 w-[min(360px,calc(100vw-1rem))] justify-start border bg-card px-3 text-left shadow-lg"
            onClick={() => setMinimized(false)}
          >
            <PenLine data-icon="inline-start" />
            <span className="min-w-0 flex-1 truncate">{minimizedTitle}</span>
            <span className="text-xs font-normal text-muted-foreground">
              Draft
            </span>
          </Button>
        </div>
      )}
    </div>
  );
}
