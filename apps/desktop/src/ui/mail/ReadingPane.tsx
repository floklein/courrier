import { useMutation } from '@tanstack/react-query';
import {
  Archive,
  Download,
  ExternalLink,
  Flag,
  MailOpen,
  MoreHorizontal,
  Paperclip,
  Reply,
  Star,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type {
  MailAttachment,
  MailActionCapability,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  ReplyToMessageInput,
} from '@/lib/mail-types';
import { api } from '@/lib/api-client';
import { formatMailDate } from '@/lib/mail/mail-utils';
import { cn } from '@/lib/utils';
import { PanelStatus } from '@/ui/app/StatusViews';
import { MailComposer } from '@/ui/compose/MailComposer';
import { ToolbarButton } from '@/ui/primitives/ToolbarButton';
import { HtmlMessageBody } from '@/ui/mail/HtmlMessageBody';
import { MailActionDropdownContent } from '@/ui/mail/MailActionMenu';
import { MailAvatar } from '@/ui/mail/MailAvatar';

export function ReadingPane({
  accountId,
  folderId,
  folders,
  actionCapabilities,
  isActionPending,
  message,
  replyMessageId,
  isSendingMessage,
  replyError,
  isLoading,
  error,
  isMailDragActive,
  onCloseReply,
  onArchiveMessage,
  onDeleteMessage,
  onMarkMessageJunkState,
  onMarkMessageReadState,
  onMoveMessage,
  onReplyToMessage,
  onReplyToMessageBody,
  onToggleMessageFlag,
  onToggleMessageImportant,
  onToggleMessageStar,
  className,
}: {
  accountId: string;
  folderId: string;
  folders: MailFolder[];
  actionCapabilities: MailActionCapability[];
  isActionPending: boolean;
  message: MailMessageDetail | undefined;
  replyMessageId: string | undefined;
  isSendingMessage: boolean;
  replyError: Error | null;
  isLoading: boolean;
  error: Error | null;
  isMailDragActive: boolean;
  onCloseReply: () => void;
  onArchiveMessage: (message: MailMessageSummary) => void;
  onDeleteMessage: (message: MailMessageSummary) => void;
  onMarkMessageJunkState: (
    message: MailMessageSummary,
    isJunk: boolean,
  ) => void;
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
  onToggleMessageFlag: (
    message: MailMessageSummary,
    isFlagged: boolean,
  ) => void;
  onToggleMessageImportant: (
    message: MailMessageSummary,
    isImportant: boolean,
  ) => void;
  onToggleMessageStar: (
    message: MailMessageSummary,
    isStarred: boolean,
  ) => void;
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
        <header
          aria-hidden="true"
          className="app-window-header app-window-controls-end app-window-controls-start-mobile h-16 shrink-0 border-b"
        />
        <EmptyMessageSelection />
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
          {actionCapabilities.includes('archive') && (
            <ToolbarButton
              icon={Archive}
              label="Archive"
              disabled={isActionPending}
              onClick={() => onArchiveMessage(message)}
            />
          )}
          {actionCapabilities.includes('star') && (
            <ToolbarButton
              icon={Star}
              label={message.isStarred ? 'Unstar' : 'Star'}
              disabled={isActionPending}
              onClick={() => onToggleMessageStar(message, !message.isStarred)}
            />
          )}
          {actionCapabilities.includes('flag') && (
            <ToolbarButton
              icon={Flag}
              label={message.isFlagged ? 'Clear flag' : 'Flag'}
              disabled={isActionPending}
              onClick={() => onToggleMessageFlag(message, !message.isFlagged)}
            />
          )}
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
              actionCapabilities={actionCapabilities}
              folders={folders}
              isBusy={isActionPending}
              message={message}
              onArchive={onArchiveMessage}
              onDelete={onDeleteMessage}
              onMarkJunk={onMarkMessageJunkState}
              onMarkReadState={onMarkMessageReadState}
              onMove={onMoveMessage}
              onReply={onReplyToMessage}
              onToggleFlag={onToggleMessageFlag}
              onToggleImportant={onToggleMessageImportant}
              onToggleStar={onToggleMessageStar}
            />
          </DropdownMenu>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <div className="flex w-full flex-col">
          <div className="flex items-start gap-4 border-b px-4 py-4">
            <MailAvatar
              name={message.sender.name}
              email={message.sender.email}
              className="size-11"
            />
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

          {message.attachments.length > 0 && (
            <MessageAttachments
              accountId={accountId}
              messageId={message.id}
              attachments={message.attachments}
            />
          )}

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
            accountId={accountId}
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

function MessageAttachments({
  accountId,
  messageId,
  attachments,
}: {
  accountId: string;
  messageId: string;
  attachments: MailAttachment[];
}) {
  const openMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      api.attachments.open(accountId, messageId, attachmentId),
  });
  const downloadMutation = useMutation({
    mutationFn: (attachmentId: string) =>
      api.attachments.download(accountId, messageId, attachmentId),
  });
  const error = openMutation.error ?? downloadMutation.error;

  return (
    <section className="border-b px-4 py-3">
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment) => (
          <div
            key={attachment.id}
            className="flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-sm"
          >
            <Paperclip className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="truncate font-medium">{attachment.name}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(attachment.size)}
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Open ${attachment.name}`}
                    disabled={openMutation.isPending || downloadMutation.isPending}
                    onClick={() => openMutation.mutate(attachment.id)}
                  >
                    <ExternalLink data-icon="inline-start" />
                  </Button>
                }
              />
              <TooltipContent>Open</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Download ${attachment.name}`}
                    disabled={openMutation.isPending || downloadMutation.isPending}
                    onClick={() => downloadMutation.mutate(attachment.id)}
                  >
                    <Download data-icon="inline-start" />
                  </Button>
                }
              />
              <TooltipContent>Download</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>
      {error && (
        <p className="mt-2 text-sm text-destructive">
          {error instanceof Error ? error.message : 'Attachment action failed.'}
        </p>
      )}
    </section>
  );
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function EmptyMessageSelection() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-64 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
          <MailOpen className="size-5 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-sm font-semibold">Select a message</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Choose a conversation from the list to read it here.
        </p>
      </div>
    </div>
  );
}
