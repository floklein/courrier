import { Loader2, Search } from 'lucide-react';
import { Button } from '../components/ui/button';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip';
import type { MailMessageSummary } from '../lib/mail-types';
import { cn } from '../lib/utils';
import { EmptyFolder } from './EmptyFolder';
import { MessageListItem } from './MessageListItem';
import { PanelStatus } from './StatusViews';

export function MessageList({
  folderId,
  folderLabel,
  messages,
  selectedMessageId,
  isLoading,
  error,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  className,
}: {
  folderId: string;
  folderLabel: string;
  messages: MailMessageSummary[];
  selectedMessageId: string | undefined;
  isLoading: boolean;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-card max-md:border-r-0',
        className,
      )}
    >
      <header className="flex h-16 items-center justify-between gap-3 px-5">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {folderLabel}
          </h1>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? 'Loading messages'
              : `${messages.length} ${
                  messages.length === 1 ? 'message' : 'messages'
                }`}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Search mail">
              <Search data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search mail</TooltipContent>
        </Tooltip>
      </header>
      <Separator />
      {isLoading && <PanelStatus label="Loading messages..." />}
      {!isLoading && error && <PanelStatus label={error.message} />}
      {!isLoading && !error && messages.length > 0 && (
        <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="flex w-full min-w-0 max-w-full flex-col overflow-hidden">
            {messages.map((message) => (
              <MessageListItem
                key={message.id}
                folderId={folderId}
                isSelected={message.id === selectedMessageId}
                message={message}
              />
            ))}
            {hasNextPage && (
              <Button
                variant="ghost"
                className="m-2"
                disabled={isFetchingNextPage}
                onClick={onLoadMore}
              >
                {isFetchingNextPage && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Load more
              </Button>
            )}
          </div>
        </ScrollArea>
      )}
      {!isLoading && !error && messages.length === 0 && <EmptyFolder />}
    </section>
  );
}
