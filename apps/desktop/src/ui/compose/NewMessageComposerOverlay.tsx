import { PenLine } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { useComposeStore } from '../../hooks/compose-store';
import type { ComposeWindowDraft } from '../../lib/compose-window';
import type { SendMailInput } from '../../lib/mail-types';
import { cn } from '../../lib/utils';
import { MailComposer } from './MailComposer';

export function NewMessageComposerOverlay({
  isSending,
  error,
  onClose,
  onMoveToWindow,
  onSend,
}: {
  isSending: boolean;
  error: Error | null;
  onClose: () => void;
  onMoveToWindow: (draft: ComposeWindowDraft) => void;
  onSend: (input: SendMailInput) => void;
}) {
  const draftSubject = useComposeStore((state) => state.draft.subject);
  const isMinimized = useComposeStore((state) => state.isMinimized);
  const setDraft = useComposeStore((state) => state.setDraft);
  const setMinimized = useComposeStore((state) => state.setMinimized);
  const minimizedTitle = draftSubject.trim() || 'New message';

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
          mode="new"
          initialDraft={useComposeStore.getState().draft}
          isSending={isSending}
          error={error}
          className="h-[min(640px,calc(100vh-6rem))]"
          onClose={onClose}
          onDraftChange={setDraft}
          onMinimize={() => setMinimized(true)}
          onMoveToWindow={onMoveToWindow}
          onReply={() => undefined}
          onSend={onSend}
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
