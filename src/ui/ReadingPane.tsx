import { Link } from '@tanstack/react-router';
import DOMPurify from 'dompurify';
import { Archive, ArrowLeft, MoreHorizontal, Reply } from 'lucide-react';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip';
import type { MailMessageDetail } from '../lib/mail-types';
import { encodeRouteId } from '../lib/route-ids';
import { cn } from '../lib/utils';
import { formatMailDate, getInitials } from './mail-utils';
import { PanelStatus } from './StatusViews';
import { ToolbarButton } from './ToolbarButton';

export function ReadingPane({
  folderId,
  message,
  isLoading,
  error,
  className,
}: {
  folderId: string;
  message: MailMessageDetail | undefined;
  isLoading: boolean;
  error: Error | null;
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

  const sanitizedBody = DOMPurify.sanitize(message.bodyContent, {
    USE_PROFILES: { html: true },
  });

  return (
    <article
      className={cn('flex min-h-0 min-w-0 flex-col bg-background', className)}
    >
      <header className="flex min-h-16 items-center justify-between gap-4 border-b px-4">
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
          <ToolbarButton icon={Reply} label="Reply" />
          <ToolbarButton icon={Archive} label="Archive" />
          <ToolbarButton icon={MoreHorizontal} label="More actions" />
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
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
            <div
              className="prose prose-sm max-w-none text-card-foreground"
              dangerouslySetInnerHTML={{ __html: sanitizedBody }}
            />
          )}
        </div>
      </ScrollArea>
    </article>
  );
}
