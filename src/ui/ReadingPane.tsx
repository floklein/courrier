import { Link } from '@tanstack/react-router';
import DOMPurify from 'dompurify';
import { ArrowLeft, MoreHorizontal, Reply, Send, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { ScrollArea } from '../components/ui/scroll-area';
import { Textarea } from '../components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip';
import type {
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
} from '../lib/mail-types';
import { encodeRouteId } from '../lib/route-ids';
import { cn } from '../lib/utils';
import { MailActionDropdownContent } from './MailActionMenu';
import { formatMailDate, getInitials } from './mail-utils';
import { PanelStatus } from './StatusViews';
import { ToolbarButton } from './ToolbarButton';

export function ReadingPane({
  folderId,
  folders,
  isActionPending,
  message,
  replyMessageId,
  isLoading,
  error,
  onCloseReply,
  onDeleteMessage,
  onMarkMessageReadState,
  onMoveMessage,
  onReplyToMessage,
  className,
}: {
  folderId: string;
  folders: MailFolder[];
  isActionPending: boolean;
  message: MailMessageDetail | undefined;
  replyMessageId: string | undefined;
  isLoading: boolean;
  error: Error | null;
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
  className?: string;
}) {
  const [htmlFrameHeight, setHtmlFrameHeight] = useState(80);

  useEffect(() => {
    setHtmlFrameHeight(80);
  }, [message?.id]);

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

  const sanitizedBody = DOMPurify.sanitize(message.bodyContent, {
    USE_PROFILES: { html: true },
  });
  const htmlDocument = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <base target="_blank" />
    <style>
      html,
      body {
        margin: 0;
      }

      body {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
    </style>
  </head>
  <body>
    ${sanitizedBody}
  </body>
</html>`;

  return (
    <article
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden bg-background',
        className,
      )}
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back to message list"
                className="hidden shrink-0 max-md:inline-flex"
                asChild
              >
                <Link
                  to="/mail/$folderId"
                  params={{ folderId: encodeRouteId(folderId) }}
                >
                  <ArrowLeft data-icon="inline-start" />
                </Link>
              </Button>
            </TooltipTrigger>
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
            label="Delete"
            disabled={isActionPending}
            onClick={() => onDeleteMessage(message)}
          />
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="More actions"
                    disabled={isActionPending}
                  >
                    <MoreHorizontal data-icon="inline-start" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
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
            <iframe
              title={message.subject || 'Message body'}
              sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
              className="w-full border-0 bg-white"
              style={{ height: htmlFrameHeight }}
              onLoad={(event) => {
                const document = event.currentTarget.contentDocument;
                const height = Math.max(
                  document?.body.scrollHeight ?? 0,
                  document?.documentElement.scrollHeight ?? 0,
                  80,
                );

                setHtmlFrameHeight(Math.ceil(height));
              }}
              srcDoc={htmlDocument}
            />
          )}
        </div>
      </ScrollArea>
      {replyMessageId === message.id && (
        <div className="shrink-0 border-t bg-card px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                Reply to {message.sender.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {message.subject}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close reply"
              onClick={onCloseReply}
            >
              <X data-icon="inline-start" />
            </Button>
          </div>
          <Textarea
            placeholder="Write a reply"
            aria-label="Reply"
            className="min-h-28 resize-none"
          />
          <div className="mt-3 flex justify-end">
            <Button disabled>
              <Send data-icon="inline-start" />
              Send
            </Button>
          </div>
        </div>
      )}
    </article>
  );
}
