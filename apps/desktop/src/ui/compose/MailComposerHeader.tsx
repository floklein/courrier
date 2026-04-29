import { ExternalLink, Minus, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import type { ComposeWindowDraft } from '../../lib/compose-window';
import type { MailMessageDetail } from '../../lib/mail-types';
import { cn } from '../../lib/utils';

export function MailComposerHeader({
  currentDraft,
  isReply,
  isSending,
  replyMessage,
  useWindowHeader,
  onClose,
  onMinimize,
  onMoveToWindow,
}: {
  currentDraft: ComposeWindowDraft;
  isReply: boolean;
  isSending: boolean;
  replyMessage?: MailMessageDetail;
  useWindowHeader?: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  onMoveToWindow?: (draft: ComposeWindowDraft) => void;
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
          {isReply ? `Reply to ${replyMessage?.sender.name ?? 'message'}` : 'New message'}
        </h2>
        {isReply && replyMessage && (
          <p className="truncate text-xs text-muted-foreground">
            {replyMessage.subject}
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
                  onClick={() => onMoveToWindow(currentDraft)}
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
