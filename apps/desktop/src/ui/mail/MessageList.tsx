import {
  Archive,
  FolderInput,
  Loader2,
  Mail,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  isArchiveFolder,
  MailActionContextContent,
} from '@/ui/mail/MailActionMenu';
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
  onForwardMessage,
  onReplyToMessage,
  onReplyAllToMessage,
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
  onDeleteMessage: (
    message: MailMessageSummary,
    removedMessageIds?: Set<string>,
  ) => void;
  onArchiveMessage: (
    message: MailMessageSummary,
    removedMessageIds?: Set<string>,
  ) => void;
  onDragActiveChange: (isActive: boolean) => void;
  onMarkMessageJunkState: (
    message: MailMessageSummary,
    isJunk: boolean,
  ) => void;
  onMarkMessageReadState: (
    message: MailMessageSummary,
    isRead: boolean,
    selectedMessageIds?: Set<string>,
  ) => void;
  onMoveMessage: (
    message: MailMessageSummary,
    destinationFolderId: string,
    removedMessageIds?: Set<string>,
  ) => void;
  onForwardMessage: (message: MailMessageSummary) => void;
  onReplyToMessage: (message: MailMessageSummary) => void;
  onReplyAllToMessage: (message: MailMessageSummary) => void;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string>();
  const [activeId, setActiveId] = useState<string>();
  const [focusRequestVersion, setFocusRequestVersion] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const pendingFocusIdRef = useRef<string | undefined>(undefined);
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
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedIds.has(message.id)),
    [messages, selectedIds],
  );
  const messageIds = useMemo(
    () => new Set(messages.map((message) => message.id)),
    [messages],
  );
  const archivableSelectedMessages = selectedMessages.filter(
    (message) => !isArchiveFolder(folders, message.folderId || folderId),
  );
  const canArchiveSelection =
    actionCapabilities.includes('archive') &&
    archivableSelectedMessages.length > 0;
  const bulkMoveFolders = folders.filter((folder) =>
    selectedMessages.some(
      (message) => (message.folderId || folderId) !== folder.id,
    ),
  );
  const hasBulkSelection = selectedMessages.length > 0;
  const shouldMarkSelectedRead = selectedMessages.some((message) => !message.isRead);

  useEffect(() => {
    setDraftSearch(searchQuery);

    if (searchQuery) {
      setIsSearching(true);
    }
  }, [searchQuery]);

  useEffect(() => {
    setSelectedIds(new Set());
    setAnchorId(selectedMessageId);
    setActiveId(selectedMessageId);
  }, [selectedMessageId]);

  useEffect(() => {
    const didChangeFolder = previousFolderIdRef.current !== folderId;
    previousFolderIdRef.current = folderId;

    if (!didChangeFolder) {
      return;
    }

    clearSelection();

    if (searchScope === 'all') {
      return;
    }

    setDraftSearch('');
    setIsSearching(false);
  }, [folderId, searchScope]);

  useEffect(() => {
    clearSelection();
  }, [searchQuery, searchScope]);

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
    const pendingFocusId = pendingFocusIdRef.current;

    if (!pendingFocusId || pendingFocusId !== activeId) {
      return;
    }

    const messageElement = [...(
      scrollParentRef.current?.querySelectorAll<HTMLElement>(
        '[data-mail-message-id]',
      ) ?? []
    )].find((element) => element.dataset.mailMessageId === pendingFocusId);
    const messageLink =
      messageElement?.querySelector<HTMLAnchorElement>('[data-message-link]');

    if (messageLink) {
      messageLink.focus();
      pendingFocusIdRef.current = undefined;
      return;
    }

    if (!messageIds.has(pendingFocusId)) {
      scrollParentRef.current?.focus();
      pendingFocusIdRef.current = undefined;
    }
  }, [activeId, focusRequestVersion, messageIds, virtualRows]);

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

  function clearSelection(nextActiveId?: string) {
    setSelectedIds(new Set());
    setAnchorId(nextActiveId);
    setActiveId(nextActiveId);
  }

  function restoreMessageFocus(messageId: string | undefined) {
    if (!messageId) {
      sectionRef.current?.focus();
      return;
    }

    pendingFocusIdRef.current = messageId;
    setFocusRequestVersion((current) => current + 1);
    setActiveId(messageId);
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

  function handleMessageFocus(message: MailMessageSummary) {
    setActiveId(message.id);
  }

  function toggleMessageSelection(message: MailMessageSummary) {
    setActiveId(message.id);
    setAnchorId(message.id);
    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(message.id)) {
        next.delete(message.id);
      } else {
        next.add(message.id);
      }

      return next;
    });
  }

  function handleSelectionControlClick(
    event: MouseEvent<HTMLElement>,
    message: MailMessageSummary,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setActiveId(message.id);

    if ((event.altKey || event.shiftKey) && anchorId) {
      selectRange(
        anchorId,
        message.id,
        isPrimaryModifier(event) ? 'add' : 'replace',
      );
      return;
    }

    toggleMessageSelection(message);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (shouldIgnoreShortcut(event.target)) {
      return;
    }

    const focusedMessageId =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-mail-message-id]')?.dataset
            .mailMessageId
        : undefined;
    const currentActiveId = focusedMessageId ?? activeId;
    const currentIndex = currentActiveId
      ? messages.findIndex((message) => message.id === currentActiveId)
      : -1;

    if (isPrimaryModifier(event) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const nextActiveId = currentActiveId ?? messages[0]?.id;
      setSelectedIds(new Set(messages.map((message) => message.id)));
      setAnchorId(nextActiveId);
      setActiveId(nextActiveId);
      return;
    }

    if (event.key === 'Escape') {
      clearSelection(currentActiveId);
      return;
    }

    const isVerticalNavigation =
      event.key === 'ArrowDown' || event.key === 'ArrowUp';
    const isBoundaryNavigation = event.key === 'Home' || event.key === 'End';

    if (
      (isVerticalNavigation || isBoundaryNavigation) &&
      !isPrimaryModifier(event) &&
      !event.altKey
    ) {
      event.preventDefault();
      const nextIndex = isBoundaryNavigation
        ? event.key === 'Home'
          ? 0
          : messages.length - 1
        : Math.max(
            0,
            Math.min(
              messages.length - 1,
              currentIndex === -1
                ? 0
                : currentIndex + (event.key === 'ArrowDown' ? 1 : -1),
            ),
          );
      const nextMessage = messages[nextIndex];

      if (!nextMessage) {
        return;
      }

      setActiveId(nextMessage.id);
      pendingFocusIdRef.current = nextMessage.id;
      rowVirtualizer.scrollToIndex(nextIndex, { align: 'auto' });

      if (event.shiftKey) {
        const nextAnchorId = hasBulkSelection
          ? anchorId ?? currentActiveId ?? nextMessage.id
          : currentActiveId ?? nextMessage.id;
        setAnchorId(nextAnchorId);
        selectRange(nextAnchorId, nextMessage.id, 'replace');
      }
      return;
    }

    if (
      isPrimaryModifier(event) &&
      event.key === ' ' &&
      currentActiveId &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      const activeMessage = messages.find(
        (message) => message.id === currentActiveId,
      );

      if (activeMessage) {
        toggleMessageSelection(activeMessage);
      }
      return;
    }

    if (!hasBulkSelection) {
      return;
    }

    if (
      (event.key === 'Delete' || event.key === 'Backspace') &&
      !isPrimaryModifier(event) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      if (isActionPending) {
        return;
      }
      deleteSelectedMessages();
      return;
    }

    if (
      event.key.toLowerCase() === 'e' &&
      canArchiveSelection &&
      !isPrimaryModifier(event) &&
      !event.altKey &&
      !event.shiftKey
    ) {
      event.preventDefault();
      if (isActionPending) {
        return;
      }
      archiveSelectedMessages();
      return;
    }
  }

  function deleteSelectedMessages() {
    if (isActionPending) {
      return;
    }

    const removedMessageIds = new Set(selectedMessages.map((message) => message.id));
    const nextFocusId = findNextFocusIdAfterRemoval(removedMessageIds);

    for (const message of selectedMessages) {
      onDeleteMessage(message, removedMessageIds);
    }

    clearSelection(nextFocusId);
    restoreMessageFocus(nextFocusId);
  }

  function markSelectedMessagesReadState(isRead: boolean) {
    if (isActionPending) {
      return;
    }

    const selectedMessageIds = new Set(
      selectedMessages.map((message) => message.id),
    );

    for (const message of selectedMessages) {
      onMarkMessageReadState(message, isRead, selectedMessageIds);
    }

    clearSelection(activeId);
    restoreMessageFocus(activeId);
  }

  function moveSelectedMessages(destinationFolderId: string) {
    if (isActionPending) {
      return;
    }

    const messagesToMove = selectedMessages.filter(
      (message) => (message.folderId || folderId) !== destinationFolderId,
    );
    const removedMessageIds = new Set(messagesToMove.map((message) => message.id));
    const nextFocusId = findNextFocusIdAfterRemoval(removedMessageIds);

    for (const message of messagesToMove) {
      onMoveMessage(message, destinationFolderId, removedMessageIds);
    }

    clearSelection(nextFocusId);
    restoreMessageFocus(nextFocusId);
  }

  function archiveSelectedMessages() {
    if (isActionPending || !canArchiveSelection) {
      return;
    }

    const removedMessageIds = new Set(
      archivableSelectedMessages.map((message) => message.id),
    );
    const nextFocusId = findNextFocusIdAfterRemoval(removedMessageIds);

    for (const message of archivableSelectedMessages) {
      onArchiveMessage(message, removedMessageIds);
    }

    clearSelection(nextFocusId);
    restoreMessageFocus(nextFocusId);
  }

  function findNextFocusIdAfterRemoval(removedMessageIds: Set<string>) {
    if (activeId && !removedMessageIds.has(activeId)) {
      return activeId;
    }

    const activeIndex = activeId
      ? messages.findIndex((message) => message.id === activeId)
      : -1;
    const messagesAfterActive =
      activeIndex >= 0 ? messages.slice(activeIndex + 1) : messages;
    const messagesBeforeActive =
      activeIndex > 0 ? messages.slice(0, activeIndex).reverse() : [];

    return [...messagesAfterActive, ...messagesBeforeActive].find(
      (message) => !removedMessageIds.has(message.id),
    )?.id;
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

    clearSelection(message.id);
    setContextMessage(message);
  }

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label={`${folderLabel} message list`}
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
      <span className="sr-only" aria-atomic="true" aria-live="polite">
        {hasBulkSelection
          ? `${selectedMessages.length} ${
              selectedMessages.length === 1 ? 'message' : 'messages'
            } selected`
          : 'Selection cleared'}
      </span>
      {hasBulkSelection && (
        <div
          role="group"
          aria-label="Selected message actions"
          className="flex h-12 shrink-0 items-center gap-2 border-b bg-muted/30 px-3 text-sm"
        >
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
                  aria-label={
                    shouldMarkSelectedRead
                      ? 'Mark selected as read'
                      : 'Mark selected as unread'
                  }
                  onClick={() =>
                    markSelectedMessagesReadState(shouldMarkSelectedRead)
                  }
                >
                  {shouldMarkSelectedRead ? (
                    <MailOpen data-icon="inline-start" />
                  ) : (
                    <Mail data-icon="inline-start" />
                  )}
                </Button>
              }
            />
            <TooltipContent>
              {shouldMarkSelectedRead ? 'Mark as read' : 'Mark as unread'}
            </TooltipContent>
          </Tooltip>
          {canArchiveSelection && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={isActionPending}
                    aria-label="Archive selected"
                    onClick={archiveSelectedMessages}
                  >
                    <Archive data-icon="inline-start" />
                  </Button>
                }
              />
              <TooltipContent>Archive</TooltipContent>
            </Tooltip>
          )}
          {bulkMoveFolders.length > 0 && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={isActionPending}
                          aria-label="Move selected"
                        >
                          <FolderInput data-icon="inline-start" />
                        </Button>
                      }
                    />
                  }
                />
                <TooltipContent>Move selected</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="max-h-72 w-56 overflow-y-auto">
                {bulkMoveFolders.map((folder) => (
                  <DropdownMenuItem
                    key={folder.id}
                    onClick={() => moveSelectedMessages(folder.id)}
                  >
                    <span className="truncate">{folder.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Tooltip>
            <TooltipTrigger
              render={
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon-sm"
                    disabled={isActionPending}
                    aria-label="Move selected to trash"
                    onClick={deleteSelectedMessages}
                >
                  <Trash2 data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent>Move to trash</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Clear selection"
                  onClick={() => {
                    clearSelection(activeId);
                    restoreMessageFocus(activeId);
                  }}
                >
                  <X data-icon="inline-start" />
                </Button>
              }
            />
            <TooltipContent>Clear selection</TooltipContent>
          </Tooltip>
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
                role="region"
                aria-label="Messages"
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
                            isKeyboardActive={message.id === activeId}
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
                            onMessageFocus={handleMessageFocus}
                            onSelectionToggle={handleSelectionControlClick}
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
              onForward={onForwardMessage}
              onReply={onReplyToMessage}
              onReplyAll={onReplyAllToMessage}
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
