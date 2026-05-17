import {
  Archive,
  Loader2,
  MailOpen,
  MousePointer2,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import type { MailFolder, MailMessageSummary } from '@/lib/mail-types';
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
  onDeleteMessage: (
    message: MailMessageSummary,
    removedMessageIds?: Set<string>,
  ) => void;
  onDragActiveChange: (isActive: boolean) => void;
  onMarkMessageReadState: (
    message: MailMessageSummary,
    isRead: boolean,
  ) => void;
  onMoveMessage: (
    message: MailMessageSummary,
    destinationFolderId: string,
    removedMessageIds?: Set<string>,
  ) => void;
  onReplyToMessage: (message: MailMessageSummary) => void;
  onSearch: (query: string) => void;
  searchQuery: string;
  className?: string;
}) {
  const [isSearching, setIsSearching] = useState(Boolean(searchQuery));
  const [draftSearch, setDraftSearch] = useState(searchQuery);
  const debouncedDraftSearch = useDebouncedValue(draftSearch, 250);
  const [contextMessage, setContextMessage] =
    useState<MailMessageSummary>();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string>();
  const [activeId, setActiveId] = useState<string>();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const loadMoreRequestLengthRef = useRef<number | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: hasNextPage ? messages.length + 1 : messages.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) =>
      index >= messages.length ? loaderRowEstimate : messageRowEstimate,
    getItemKey: (index) => messages[index]?.id ?? `load-more-${folderId}`,
    overscan: overscanRows,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedIds.has(message.id)),
    [messages, selectedIds],
  );
  const messageIds = useMemo(
    () => new Set(messages.map((message) => message.id)),
    [messages],
  );
  const archiveFolder = folders.find((folder) => folder.wellKnownName === 'archive');
  const hasBulkSelection = selectedMessages.length > 0;

  useEffect(() => {
    setDraftSearch(searchQuery);

    if (searchQuery) {
      setIsSearching(true);
    }
  }, [searchQuery]);

  useEffect(() => {
    setDraftSearch('');
    setIsSearching(false);
    clearSelection();
  }, [folderId]);

  useEffect(() => {
    clearSelection();
  }, [searchQuery]);

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
  }, [folderId, messages.length, searchQuery]);

  useEffect(() => {
    if (
      contextMessage &&
      !messages.some((message) => message.id === contextMessage.id)
    ) {
      setContextMessage(undefined);
    }
  }, [contextMessage, messages]);

  useEffect(() => {
    setSelectedIds((current) => {
      let changed = false;
      const next = new Set<string>();

      for (const id of current) {
        if (messageIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
    setAnchorId((current) =>
      current && !messageIds.has(current) ? undefined : current,
    );
    setActiveId((current) =>
      current && !messageIds.has(current) ? undefined : current,
    );
  }, [messageIds]);

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
  }

  function clearSelection(nextActiveId?: string) {
    setSelectedIds(new Set());
    setAnchorId(nextActiveId);
    setActiveId(nextActiveId);
  }

  function selectRange(fromId: string, toId: string, mode: 'replace' | 'add') {
    const fromIndex = messages.findIndex((message) => message.id === fromId);
    const toIndex = messages.findIndex((message) => message.id === toId);

    if (fromIndex === -1 || toIndex === -1) {
      return;
    }

    const [start, end] = [fromIndex, toIndex].sort((left, right) => left - right);
    const rangeIds = messages.slice(start, end + 1).map((message) => message.id);

    setSelectedIds((current) => {
      const next = mode === 'add' ? new Set(current) : new Set<string>();

      for (const id of rangeIds) {
        next.add(id);
      }

      return next;
    });
  }

  function handleMessageClick(
    event: MouseEvent<HTMLAnchorElement>,
    message: MailMessageSummary,
  ) {
    setActiveId(message.id);

    if (isPrimaryModifier(event) || event.altKey || event.shiftKey) {
      event.preventDefault();

      if ((event.altKey || event.shiftKey) && anchorId) {
        selectRange(anchorId, message.id, isPrimaryModifier(event) ? 'add' : 'replace');
        return;
      }

      setSelectedIds((current) => {
        const next = new Set(current);

        if (next.has(message.id)) {
          next.delete(message.id);
        } else {
          next.add(message.id);
        }

        return next;
      });
      setAnchorId(message.id);
      return;
    }

    clearSelection(message.id);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (shouldIgnoreShortcut(event.target)) {
      return;
    }

    const currentIndex = activeId
      ? messages.findIndex((message) => message.id === activeId)
      : -1;

    if (isPrimaryModifier(event) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelectedIds(new Set(messages.map((message) => message.id)));
      setAnchorId(messages[0]?.id);
      setActiveId(messages[0]?.id);
      return;
    }

    if (event.key === 'Escape') {
      clearSelection();
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = Math.max(
        0,
        Math.min(messages.length - 1, currentIndex === -1 ? 0 : currentIndex + delta),
      );
      const nextMessage = messages[nextIndex];

      if (!nextMessage) {
        return;
      }

      setActiveId(nextMessage.id);
      rowVirtualizer.scrollToIndex(nextIndex, { align: 'auto' });

      if (event.shiftKey) {
        const nextAnchorId = anchorId ?? activeId ?? nextMessage.id;
        setAnchorId(nextAnchorId);
        selectRange(nextAnchorId, nextMessage.id, 'replace');
      }
      return;
    }

    if (!hasBulkSelection) {
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (isActionPending) {
        return;
      }
      deleteSelectedMessages();
      return;
    }

    if (event.key.toLowerCase() === 'e' && archiveFolder) {
      event.preventDefault();
      if (isActionPending) {
        return;
      }
      moveSelectedMessages(archiveFolder.id);
      return;
    }
  }

  function deleteSelectedMessages() {
    if (isActionPending) {
      return;
    }

    const removedMessageIds = new Set(selectedMessages.map((message) => message.id));

    for (const message of selectedMessages) {
      onDeleteMessage(message, removedMessageIds);
    }

    clearSelection();
  }

  function markSelectedMessagesReadState(isRead: boolean) {
    if (isActionPending) {
      return;
    }

    for (const message of selectedMessages) {
      onMarkMessageReadState(message, isRead);
    }

    clearSelection();
  }

  function moveSelectedMessages(destinationFolderId: string) {
    if (isActionPending) {
      return;
    }

    const removedMessageIds = new Set(selectedMessages.map((message) => message.id));

    for (const message of selectedMessages) {
      onMoveMessage(message, destinationFolderId, removedMessageIds);
    }

    clearSelection();
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
      <header className="app-window-header app-window-controls-end-mobile flex h-16 shrink-0 items-center justify-between gap-3 border-b px-5">
        {isSearching ? (
          <div
            className="flex min-w-0 flex-1 items-center gap-2"
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
      {hasBulkSelection && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/30 px-3 text-sm">
          <span className="flex min-w-0 flex-1 items-center gap-2 font-medium">
            <MousePointer2 className="size-4 text-muted-foreground" />
            {selectedMessages.length} selected
          </span>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isActionPending}
                  aria-label="Mark selected as read"
                  onClick={() => markSelectedMessagesReadState(true)}
                >
                  <MailOpen data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent>Mark as read</TooltipContent>
          </Tooltip>
          {archiveFolder && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={isActionPending}
                    aria-label="Archive selected"
                    onClick={() => moveSelectedMessages(archiveFolder.id)}
                  >
                    <Archive data-icon="inline-start" />
                  </Button>
                }
              />
              <TooltipContent>Archive</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isActionPending}
                  aria-label="Delete selected"
                  onClick={deleteSelectedMessages}
                >
                  <Trash2 data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => clearSelection()}
          >
            Clear
          </Button>
        </div>
      )}
      {isLoading && <PanelStatus label="Loading messages..." />}
      {!isLoading && error && <PanelStatus label={error.message} />}
      {!isLoading && !error && messages.length > 0 && (
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div
                ref={scrollParentRef}
                tabIndex={0}
                className="min-h-0 min-w-0 flex-1 overflow-auto"
                onContextMenu={handleContextMenu}
                onKeyDown={handleKeyDown}
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
                            isBulkSelected={selectedIds.has(message.id)}
                            isActionPending={isActionPending}
                            dragMessages={
                              selectedIds.has(message.id) && selectedMessages.length > 0
                                ? selectedMessages
                                : [message]
                            }
                            message={message}
                            onDragActiveChange={onDragActiveChange}
                            onMessageClick={handleMessageClick}
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
              currentFolderId={folderId}
              folders={folders}
              isBusy={isActionPending}
              message={contextMessage}
              onDelete={onDeleteMessage}
              onMarkReadState={onMarkMessageReadState}
              onMove={onMoveMessage}
              onReply={onReplyToMessage}
            />
          )}
        </ContextMenu>
      )}
      {!isLoading && !error && messages.length === 0 && <EmptyFolder />}
    </section>
  );
}

function isPrimaryModifier(event: MouseEvent | KeyboardEvent) {
  return event.metaKey || event.ctrlKey;
}

function shouldIgnoreShortcut(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      'input, textarea, [contenteditable="true"], [role="menu"], [role="dialog"]',
    ),
  );
}
