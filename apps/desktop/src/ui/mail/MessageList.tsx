import { MouseEvent, useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Loader2, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type {
  MailActionCapability,
  MailFolder,
  MailMessageSummary,
  MailSearchScope,
} from '@/lib/mail-types';
import { cn } from '@/lib/utils';
import { PanelStatus } from '@/ui/app/StatusViews';
import { EmptyFolder } from '@/ui/mail/EmptyFolder';
import { MailActionContextContent } from '@/ui/mail/MailActionMenu';
import { MessageListItem } from '@/ui/mail/MessageListItem';

const messageRowEstimate = 104;
const loaderRowEstimate = 52;
const overscanRows = 8;

export function MessageList({
  folderId,
  folderLabel,
  folders,
  actionCapabilities,
  messages,
  selectedMessageId,
  isLoading,
  error,
  hasNextPage,
  isFetchingNextPage,
  isActionPending,
  onLoadMore,
  onDeleteMessage,
  onArchiveMessage,
  onDragActiveChange,
  onMarkMessageJunkState,
  onMarkMessageReadState,
  onMoveMessage,
  onReplyToMessage,
  onToggleMessageFlag,
  onToggleMessageImportant,
  onToggleMessageStar,
  onSearch,
  onSearchScopeChange,
  searchQuery,
  searchScope,
  className,
}: {
  folderId: string;
  folderLabel: string;
  folders: MailFolder[];
  actionCapabilities: MailActionCapability[];
  messages: MailMessageSummary[];
  selectedMessageId: string | undefined;
  isLoading: boolean;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isActionPending: boolean;
  onLoadMore: () => void;
  onDeleteMessage: (message: MailMessageSummary) => void;
  onArchiveMessage: (message: MailMessageSummary) => void;
  onDragActiveChange: (isActive: boolean) => void;
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
  onSearch: (query: string) => void;
  onSearchScopeChange: (scope: MailSearchScope) => void;
  searchQuery: string;
  searchScope: MailSearchScope;
  className?: string;
}) {
  const [isSearching, setIsSearching] = useState(Boolean(searchQuery));
  const [draftSearch, setDraftSearch] = useState(searchQuery);
  const debouncedDraftSearch = useDebouncedValue(draftSearch, 250);
  const [contextMessage, setContextMessage] =
    useState<MailMessageSummary>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const loadMoreRequestLengthRef = useRef<number | null>(null);
  const previousFolderIdRef = useRef(folderId);
  const rowVirtualizer = useVirtualizer({
    count: hasNextPage ? messages.length + 1 : messages.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) =>
      index >= messages.length ? loaderRowEstimate : messageRowEstimate,
    getItemKey: (index) => messages[index]?.id ?? `load-more-${folderId}`,
    overscan: overscanRows,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    setDraftSearch(searchQuery);

    if (searchQuery) {
      setIsSearching(true);
    }
  }, [searchQuery]);

  useEffect(() => {
    const didChangeFolder = previousFolderIdRef.current !== folderId;
    previousFolderIdRef.current = folderId;

    if (!didChangeFolder) {
      return;
    }

    if (searchScope === 'all') {
      return;
    }

    setDraftSearch('');
    setIsSearching(false);
  }, [folderId, searchScope]);

  useEffect(() => {
    if (!isSearching) {
      return;
    }

    const nextSearchQuery = debouncedDraftSearch.trim();

    if (nextSearchQuery === searchQuery) {
      return;
    }

    onSearch(nextSearchQuery);
  }, [debouncedDraftSearch, isSearching, onSearch, searchQuery]);

  useEffect(() => {
    if (!isSearching) {
      return;
    }

    searchInputRef.current?.focus();
  }, [isSearching]);

  useEffect(() => {
    loadMoreRequestLengthRef.current = null;
  }, [folderId, messages.length, searchQuery, searchScope]);

  useEffect(() => {
    if (
      contextMessage &&
      !messages.some((message) => message.id === contextMessage.id)
    ) {
      setContextMessage(undefined);
    }
  }, [contextMessage, messages]);

  useEffect(() => {
    const lastVirtualRow = virtualRows.at(-1);

    if (!lastVirtualRow) {
      return;
    }

    if (
      lastVirtualRow.index >= messages.length &&
      hasNextPage &&
      !isFetchingNextPage &&
      loadMoreRequestLengthRef.current !== messages.length
    ) {
      loadMoreRequestLengthRef.current = messages.length;
      onLoadMore();
    }
  }, [
    hasNextPage,
    isFetchingNextPage,
    messages.length,
    onLoadMore,
    virtualRows,
  ]);

  function clearSearch() {
    setDraftSearch('');
    setIsSearching(false);
    onSearch('');
    onSearchScopeChange('folder');
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) {
      event.preventDefault();
      setContextMessage(undefined);
      return;
    }

    const messageElement = event.target.closest<HTMLElement>(
      '[data-mail-message-id]',
    );
    const messageId = messageElement?.dataset.mailMessageId;
    const message = messages.find((item) => item.id === messageId);

    if (!message) {
      event.preventDefault();
      setContextMessage(undefined);
      return;
    }

    setContextMessage(message);
  }

  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-card max-md:border-r-0',
        className,
      )}
    >
      <header
        className={cn(
          'app-window-header app-window-controls-end-mobile flex shrink-0 items-center justify-between gap-3 border-b px-5',
          isSearching ? 'min-h-24 py-2' : 'h-16',
        )}
      >
        {isSearching ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Input
                ref={searchInputRef}
                value={draftSearch}
                onChange={(event) => setDraftSearch(event.target.value)}
                placeholder={
                  searchScope === 'all'
                    ? 'Search all mail'
                    : `Search ${folderLabel}`
                }
                aria-label={
                  searchScope === 'all'
                    ? 'Search all mail'
                    : `Search ${folderLabel}`
                }
                className="h-8"
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Clear search"
                      onClick={clearSearch}
                    >
                      <X data-icon="inline-start" />
                    </Button>
                  }
                />
                <TooltipContent>Clear search</TooltipContent>
              </Tooltip>
            </div>
            <Tabs
              value={searchScope}
              onValueChange={(value) =>
                onSearchScopeChange(value as MailSearchScope)
              }
            >
              <TabsList className="h-7 w-full">
                <TabsTrigger value="all" className="h-6 text-xs">
                  All mail
                </TabsTrigger>
                <TabsTrigger value="folder" className="h-6 text-xs">
                  This folder
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
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
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Search mail"
                      onClick={() => setIsSearching(true)}
                    >
                      <Search data-icon="inline-start" />
                    </Button>
                  }
                />
                <TooltipContent>Search mail</TooltipContent>
              </Tooltip>
            </div>
          </>
        )}
      </header>
      {isLoading && <PanelStatus label="Loading messages..." />}
      {!isLoading && error && <PanelStatus label={error.message} />}
      {!isLoading && !error && messages.length > 0 && (
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div
                ref={scrollParentRef}
                className="min-h-0 min-w-0 flex-1 overflow-auto"
                onContextMenu={handleContextMenu}
              >
                <div
                  className="relative w-full min-w-0 max-w-full"
                  style={{ height: rowVirtualizer.getTotalSize() }}
                >
                  {virtualRows.map((virtualRow) => {
                    const message = messages[virtualRow.index];
                    return (
                      <div
                        key={virtualRow.key}
                        ref={rowVirtualizer.measureElement}
                        data-index={virtualRow.index}
                        className="absolute left-0 top-0 w-full"
                        style={{
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      >
                        {message ? (
                          <MessageListItem
                            folderId={folderId}
                            isSelected={message.id === selectedMessageId}
                            isActionPending={isActionPending}
                            message={message}
                            onDragActiveChange={onDragActiveChange}
                          />
                        ) : (
                          <div className="flex h-12 items-center justify-center gap-2 text-sm text-muted-foreground">
                            {isFetchingNextPage && (
                              <Loader2 className="size-4 animate-spin" />
                            )}
                            {isFetchingNextPage ? (
                              'Loading more messages...'
                            ) : (
                              <Button variant="ghost" onClick={onLoadMore}>
                                Load more
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            }
          />
          {contextMessage && (
            <MailActionContextContent
              currentFolderId={contextMessage.folderId || folderId}
              actionCapabilities={actionCapabilities}
              folders={folders}
              isBusy={isActionPending}
              message={contextMessage}
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
          )}
        </ContextMenu>
      )}
      {!isLoading && !error && messages.length === 0 && <EmptyFolder />}
    </section>
  );
}
