import { ExternalLink, Minus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ComposeWindowDraft } from '@/lib/compose-window';
import type { MailMessageDetail } from '@/lib/mail-types';
import { cn } from '@/lib/utils';

type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export function MailComposerHeader({
  currentDraft,
  isReply,
  isSending,
  autosaveStatus,
  replyMessage,
  useWindowHeader,
  onClose,
  onMinimize,
  onMoveToWindow,
}: {
  currentDraft: ComposeWindowDraft;
  isReply: boolean;
  isSending: boolean;
  autosaveStatus?: AutosaveStatus;
  replyMessage?: MailMessageDetail;
  useWindowHeader?: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  onMoveToWindow?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-between gap-3 border-b px-4',
        isReply ? 'py-4' : 'h-16',
        !isReply && useWindowHeader && 'app-window-header app-window-controls-end',
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-base font-semibold">
          {getComposerTitle(currentDraft, replyMessage)}
        </h2>
        {isReply && replyMessage && (
          <p className="truncate text-xs text-muted-foreground">
            {replyMessage.subject}
          </p>
        )}
        {autosaveStatus && autosaveStatus !== 'idle' && (
          <p className="truncate text-xs text-muted-foreground">
            {getAutosaveLabel(autosaveStatus)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onMinimize && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Minimize composer"
                  disabled={isSending}
                  onClick={onMinimize}
                >
                  <Minus data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent>Minimize</TooltipContent>
          </Tooltip>
        )}
        {onMoveToWindow && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Move composer to window"
                  disabled={isSending}
                  onClick={onMoveToWindow}
                >
                  <ExternalLink data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent>Open in window</TooltipContent>
          </Tooltip>
        )}
        {!useWindowHeader && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cancel composer"
                  disabled={isSending}
                  onClick={onClose}
                >
                  <X data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent>Cancel</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function getAutosaveLabel(status: AutosaveStatus) {
  if (status === 'saving') {
    return 'Saving...';
  }

  if (status === 'failed') {
    return 'Autosave failed';
  }

  return 'Saved';
}

function getComposerTitle(
  draft: ComposeWindowDraft,
  replyMessage: MailMessageDetail | undefined,
) {
  if (draft.kind === 'replyAll') {
    return `Reply all to ${replyMessage?.sender.name ?? 'message'}`;
  }

  if (draft.kind === 'forward') {
    return `Forward ${replyMessage?.sender.name ?? 'message'}`;
  }

  if (draft.kind === 'reply') {
    return `Reply to ${replyMessage?.sender.name ?? 'message'}`;
  }

  return 'New message';
}
