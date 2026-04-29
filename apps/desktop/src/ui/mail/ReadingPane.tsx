import { Link } from '@tanstack/react-router';
import { ArrowLeft, MoreHorizontal, Reply, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { Button, buttonVariants } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import type {
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  ReplyToMessageInput,
} from '../../lib/mail-types';
import { formatMailDate, getInitials } from '../../lib/mail/mail-utils';
import { encodeRouteId } from '../../lib/route-ids';
import { cn } from '../../lib/utils';
import { PanelStatus } from '../app/StatusViews';
import { MailComposer } from '../compose/MailComposer';
import { ToolbarButton } from '../primitives/ToolbarButton';
import { HtmlMessageBody } from './HtmlMessageBody';
import { MailActionDropdownContent } from './MailActionMenu';

export function ReadingPane({
  folderId,
  folders,
  isActionPending,
  message,
  replyMessageId,
  isSendingMessage,
  replyError,
  isLoading,
  error,
  isMailDragActive,
  onCloseReply,
  onDeleteMessage,
  onMarkMessageReadState,
  onMoveMessage,
  onReplyToMessage,
  onReplyToMessageBody,
  className,
}: {
  folderId: string;
  folders: MailFolder[];
  isActionPending: boolean;
  message: MailMessageDetail | undefined;
  replyMessageId: string | undefined;
  isSendingMessage: boolean;
  replyError: Error | null;
  isLoading: boolean;
  error: Error | null;
  isMailDragActive: boolean;
  onCloseReply: () => void;
  onDeleteMessage: (message: MailMessageSummary) => void;
  onMarkMessageReadState: (
    message: MailMessageSummary,
    isRead: boolean,
  ) => void;
  onMoveMessage: (
    message: MailMessageSummary,
    destinationFolderId: string,
  ) => void;
  onReplyToMessage: (message: MailMessageSummary) => void;
  onReplyToMessageBody: (input: ReplyToMessageInput) => void;
  className?: string;
}) {
  if (isLoading) {
    return (
      <section
        className={cn(
          'flex min-h-0 min-w-0 flex-col bg-background',
          className,
        )}
      >
        <PanelStatus label="Loading message..." />
      </section>
    );
  }

  if (error) {
    return (
      <section
        className={cn(
          'flex min-h-0 min-w-0 flex-col bg-background',
          className,
        )}
      >
        <PanelStatus label={error.message} />
      </section>
    );
  }

  if (!message) {
    return (
      <section
        className={cn(
          'flex min-h-0 min-w-0 flex-col bg-background max-md:hidden',
          className,
        )}
      >
        <PanelStatus label="Select a message" />
      </section>
    );
  }

  return (
    <article
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden bg-background',
        className,
      )}
    >
      <header className="app-window-header app-window-controls-end app-window-controls-start-mobile flex h-16 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  to="/mail/$folderId"
                  params={{ folderId: encodeRouteId(folderId) }}
                  aria-label="Back to message list"
                  className={buttonVariants({
                    variant: 'ghost',
                    size: 'icon-sm',
                    className: 'hidden shrink-0 max-md:inline-flex',
                  })}
                >
                  <ArrowLeft data-icon="inline-start" />
                </Link>
              }
            />
            <TooltipContent>Back to message list</TooltipContent>
          </Tooltip>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {formatMailDate(message.receivedDateTime, 'long')}
            </p>
            <h2 className="truncate text-lg font-semibold tracking-tight">
              {message.subject}
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton
            icon={Reply}
            label="Reply"
            disabled={isActionPending}
            onClick={() => onReplyToMessage(message)}
          />
          <ToolbarButton
            icon={Trash2}
            label="Move to trash"
            disabled={isActionPending}
            onClick={() => onDeleteMessage(message)}
          />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="More actions"
                        disabled={isActionPending}
                      >
                        <MoreHorizontal data-icon="inline-start" />
                      </Button>
                    }
                  />
                }
              />
              <TooltipContent>More actions</TooltipContent>
            </Tooltip>
            <MailActionDropdownContent
              currentFolderId={folderId}
              folders={folders}
              isBusy={isActionPending}
              message={message}
              onDelete={onDeleteMessage}
              onMarkReadState={onMarkMessageReadState}
              onMove={onMoveMessage}
              onReply={onReplyToMessage}
            />
          </DropdownMenu>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <div className="flex w-full flex-col">
          <div className="flex items-start gap-4 border-b px-4 py-4">
            <Avatar className="size-11">
              <AvatarFallback>{getInitials(message.sender.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{message.sender.name}</p>
                {message.sender.email && (
                  <span className="text-sm text-muted-foreground">
                    {message.sender.email}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                To {message.recipients.join(', ') || 'undisclosed recipients'}
              </p>
            </div>
            <Badge variant={message.isRead ? 'secondary' : 'default'}>
              {message.isRead ? 'Read' : 'Unread'}
            </Badge>
          </div>

          {message.bodyContentType === 'text' ? (
            <div className="px-4 py-4">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-card-foreground">
                {message.bodyContent}
              </pre>
            </div>
          ) : (
            <HtmlMessageBody
              bodyContent={message.bodyContent}
              isMailDragActive={isMailDragActive}
              title={message.subject || 'Message body'}
            />
          )}
        </div>
      </ScrollArea>
      {replyMessageId === message.id && (
        <MailComposer
          mode="reply"
          replyMessage={message}
          isSending={isSendingMessage}
          error={replyError}
          className="max-h-[46vh] shrink-0 border-t"
          onClose={onCloseReply}
          onReply={onReplyToMessageBody}
          onSend={() => undefined}
        />
      )}
    </article>
  );
}
