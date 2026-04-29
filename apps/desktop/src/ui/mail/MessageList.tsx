import { FormEvent, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import type { MailFolder, MailMessageSummary } from '../../lib/mail-types';
import { cn } from '../../lib/utils';
import { PanelStatus } from '../app/StatusViews';
import { EmptyFolder } from './EmptyFolder';
import { MessageListItem } from './MessageListItem';

export function MessageList({
  folderId,
  folderLabel,
  folders,
  messages,
  selectedMessageId,
  isLoading,
  error,
  hasNextPage,
  isFetchingNextPage,
  isActionPending,
  onLoadMore,
  onDeleteMessage,
  onDragActiveChange,
  onMarkMessageReadState,
  onMoveMessage,
  onReplyToMessage,
  onSearch,
  searchQuery,
  className,
}: {
  folderId: string;
  folderLabel: string;
  folders: MailFolder[];
  messages: MailMessageSummary[];
  selectedMessageId: string | undefined;
  isLoading: boolean;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isActionPending: boolean;
  onLoadMore: () => void;
  onDeleteMessage: (message: MailMessageSummary) => void;
  onDragActiveChange: (isActive: boolean) => void;
  onMarkMessageReadState: (
    message: MailMessageSummary,
    isRead: boolean,
  ) => void;
  onMoveMessage: (
    message: MailMessageSummary,
    destinationFolderId: string,
  ) => void;
  onReplyToMessage: (message: MailMessageSummary) => void;
  onSearch: (query: string) => void;
  searchQuery: string;
  className?: string;
}) {
  const [isSearching, setIsSearching] = useState(Boolean(searchQuery));
  const [draftSearch, setDraftSearch] = useState(searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftSearch(searchQuery);
    setIsSearching(Boolean(searchQuery));
  }, [searchQuery]);

  useEffect(() => {
    if (!isSearching) {
      return;
    }

    searchInputRef.current?.focus();
  }, [isSearching]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearch(draftSearch.trim());
  }

  function clearSearch() {
    setDraftSearch('');
    setIsSearching(false);
    onSearch('');
  }

  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-card max-md:border-r-0',
        className,
      )}
    >
      <header className="app-window-header app-window-controls-end-mobile flex h-16 shrink-0 items-center justify-between gap-3 border-b px-5">
        {isSearching ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-2"
            onSubmit={handleSearchSubmit}
          >
            <Input
              ref={searchInputRef}
              value={draftSearch}
              onChange={(event) => setDraftSearch(event.target.value)}
              placeholder={`Search ${folderLabel}`}
              aria-label={`Search ${folderLabel}`}
              className="h-8"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Clear search"
                  onClick={clearSearch}
                >
                  <X data-icon="inline-start" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear search</TooltipContent>
            </Tooltip>
          </form>
        ) : (
          <>
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
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Search mail"
                    onClick={() => setIsSearching(true)}
                  >
                    <Search data-icon="inline-start" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Search mail</TooltipContent>
              </Tooltip>
            </div>
          </>
        )}
      </header>
      {isLoading && <PanelStatus label="Loading messages..." />}
      {!isLoading && error && <PanelStatus label={error.message} />}
      {!isLoading && !error && messages.length > 0 && (
        <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="flex w-full min-w-0 max-w-full flex-col overflow-hidden">
            {messages.map((message) => (
              <MessageListItem
                key={message.id}
                folderId={folderId}
                folders={folders}
                isSelected={message.id === selectedMessageId}
                isActionPending={isActionPending}
                message={message}
                onDelete={onDeleteMessage}
                onDragActiveChange={onDragActiveChange}
                onMarkReadState={onMarkMessageReadState}
                onMove={onMoveMessage}
                onReply={onReplyToMessage}
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
