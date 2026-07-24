import { act, fireEvent, render, screen } from '@testing-library/react';
import type {
  FocusEventHandler,
  MouseEventHandler,
  ReactNode,
} from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type {
  MailFolder,
  MailMessageSummary,
  MailSearchScope,
} from '@/lib/mail-types';
import { MessageList } from '@/ui/mail/MessageList';

const mailActionContextContentMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    className,
    draggable,
    onClick,
    onFocus,
    params,
    ...props
  }: {
    children: ReactNode;
    className?: string;
    draggable?: boolean;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
    onFocus?: FocusEventHandler<HTMLAnchorElement>;
    params?: { messageId?: string };
    to?: string;
    'data-message-link'?: boolean;
  }) => (
    <a
      {...props}
      className={className}
      draggable={draggable}
      href={`/mail/message/${params?.messageId ?? ''}`}
      onClick={onClick}
      onFocus={onFocus}
    >
      {children}
    </a>
  ),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({
    count,
    estimateSize,
    getItemKey,
  }: {
    count: number;
    estimateSize: (index: number) => number;
    getItemKey?: (index: number) => React.Key;
  }) => ({
    getTotalSize: () =>
      Array.from({ length: count }, (_, index) => estimateSize(index)).reduce(
        (total, size) => total + size,
        0,
      ),
    getVirtualItems: () => {
      let start = 0;

      return Array.from({ length: count }, (_, index) => {
        const size = estimateSize(index);
        const item = {
          index,
          key: getItemKey?.(index) ?? index,
          size,
          start,
        };
        start += size;
        return item;
      });
    },
    measureElement: () => undefined,
    scrollToIndex: vi.fn(),
  }),
}));

vi.mock('@/ui/mail/MailActionMenu', () => ({
  isArchiveFolder: (folders: MailFolder[], currentFolderId: string) => {
    const currentFolder = folders.find((folder) => folder.id === currentFolderId);

    return (
      currentFolder?.wellKnownName === 'archive' ||
      currentFolderId === 'archive'
    );
  },
  MailActionContextContent: (props: { currentFolderId: string }) => {
    mailActionContextContentMock(props);

    return (
      <div
        data-current-folder-id={props.currentFolderId}
        data-testid="mail-action-context"
      />
    );
  },
}));

describe('MessageList', () => {
  it('debounces folder search while typing instead of waiting for submit', () => {
    vi.useFakeTimers();
    const { onSearch } = renderMessageList();

    fireEvent.click(screen.getByRole('button', { name: 'Search mail' }));
    fireEvent.change(screen.getByLabelText('Search Inbox'), {
      target: { value: 'budget' },
    });

    expect(onSearch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(onSearch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onSearch).toHaveBeenCalledWith('budget');
    vi.useRealTimers();
  });

  it('keeps search mode open after typing an empty search', () => {
    vi.useFakeTimers();
    renderControlledMessageList();

    fireEvent.click(screen.getByRole('button', { name: 'Search mail' }));
    const input = screen.getByLabelText('Search Inbox');
    fireEvent.change(input, { target: { value: 'budget' } });

    act(() => {
      vi.advanceTimersByTime(250);
    });

    fireEvent.change(input, { target: { value: '' } });
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(screen.getByLabelText('Search Inbox')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders all-mail search tabs and switches scope', () => {
    const onSearchScopeChange = vi.fn();
    renderMessageList({ onSearchScopeChange, searchScope: 'all' });

    fireEvent.click(screen.getByRole('button', { name: 'Search mail' }));

    expect(screen.getByLabelText('Search all mail')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'All mail',
      'This folder',
    ]);
    fireEvent.click(screen.getByRole('tab', { name: 'This folder' }));

    expect(onSearchScopeChange).toHaveBeenCalledWith('folder');
  });

  it('keeps search mode open when switching from all mail to this folder', () => {
    renderControlledScopeMessageList();

    fireEvent.click(screen.getByRole('button', { name: 'Search mail' }));
    fireEvent.click(screen.getByRole('tab', { name: 'This folder' }));

    expect(screen.getByLabelText('Search Inbox')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'This folder' })).toHaveAttribute(
      'data-active',
    );
  });

  it('uses a global search result folder for context actions', () => {
    renderMessageList({
      folders: [
        folder({ id: 'inbox', label: 'Inbox' }),
        folder({ id: 'sent', label: 'Sent' }),
      ],
      messages: [message({ id: 'message-1', folderId: 'sent' })],
      searchScope: 'all',
    });

    fireEvent.contextMenu(screen.getByText('Subject message-1'));

    expect(screen.getByTestId('mail-action-context')).toHaveAttribute(
      'data-current-folder-id',
      'sent',
    );
  });

  it('exposes an accessible selection control', () => {
    renderMessageList({ messages: [message({ id: 'message-1' })] });

    const selectButton = screen.getByRole('button', {
      name: 'Select Subject message-1',
    });
    fireEvent.click(selectButton);

    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(selectButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('drops bulk selection when selected messages leave the current list', () => {
    const { rerenderMessageList } = renderMessageList({
      messages: [message({ id: 'message-1' }), message({ id: 'message-2' })],
    });

    fireEvent.click(getMessageLink('message-1'), { ctrlKey: true });
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    rerenderMessageList({ messages: [message({ id: 'message-2' })] });

    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });

  it('uses provider-aware archive for every selected message with one removal set', () => {
    const onArchiveMessage = vi.fn();
    renderMessageList({
      actionCapabilities: ['archive'],
      messages: [message({ id: 'message-1' }), message({ id: 'message-2' })],
      onArchiveMessage,
    });

    fireEvent.click(getMessageLink('message-1'), { ctrlKey: true });
    fireEvent.click(getMessageLink('message-2'), { ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }));

    expect(onArchiveMessage).toHaveBeenCalledTimes(2);
    const removedMessageIds = onArchiveMessage.mock.calls[0]?.[1];
    expect(removedMessageIds).toBeInstanceOf(Set);
    expect(onArchiveMessage.mock.calls[1]?.[1]).toBe(removedMessageIds);
    expect([...(removedMessageIds as Set<string>)]).toEqual([
      'message-1',
      'message-2',
    ]);
  });

  it('does not offer archive when every selected message is already archived', () => {
    renderMessageList({
      actionCapabilities: ['archive'],
      folderId: 'archive',
      folders: [
        folder({ id: 'archive', label: 'Archive', wellKnownName: 'archive' }),
      ],
      messages: [message({ id: 'message-1', folderId: 'archive' })],
    });

    fireEvent.click(getMessageLink('message-1'), { ctrlKey: true });

    expect(
      screen.queryByRole('button', { name: 'Archive selected' }),
    ).not.toBeInTheDocument();
  });

  it('suppresses keyboard bulk actions while an action is pending', () => {
    const onDeleteMessage = vi.fn();
    renderMessageList({
      isActionPending: true,
      messages: [message({ id: 'message-1' })],
      onDeleteMessage,
    });

    fireEvent.click(getMessageLink('message-1'), { ctrlKey: true });
    fireEvent.keyDown(getMessageListScroller(), { key: 'Delete' });

    expect(onDeleteMessage).not.toHaveBeenCalled();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('moves DOM focus with arrows and Home or End', () => {
    renderMessageList({
      messages: [
        message({ id: 'message-1' }),
        message({ id: 'message-2' }),
        message({ id: 'message-3' }),
      ],
    });

    const secondLink = getMessageLink('message-2');
    act(() => {
      secondLink.focus();
    });
    fireEvent.keyDown(secondLink, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(getMessageLink('message-3'));

    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(getMessageLink('message-1'));

    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(getMessageLink('message-3'));
  });

  it('keeps the focused row as the Shift range anchor after Escape', () => {
    const onArchiveMessage = vi.fn();
    renderMessageList({
      actionCapabilities: ['archive'],
      messages: [
        message({ id: 'message-1' }),
        message({ id: 'message-2' }),
        message({ id: 'message-3' }),
      ],
      onArchiveMessage,
    });

    const secondLink = getMessageLink('message-2');
    act(() => {
      secondLink.focus();
    });
    fireEvent.keyDown(secondLink, { key: 'a', ctrlKey: true });
    expect(screen.getByText('3 selected')).toBeInTheDocument();

    fireEvent.keyDown(secondLink, { key: 'Escape' });
    expect(screen.queryByText('3 selected')).not.toBeInTheDocument();

    fireEvent.keyDown(secondLink, { key: 'ArrowDown', shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }));

    expect(onArchiveMessage.mock.calls.map(([selected]) => selected.id)).toEqual([
      'message-2',
      'message-3',
    ]);
  });

  it('keeps the original anchor when pointer focus precedes Shift click', () => {
    renderMessageList({
      messages: [
        message({ id: 'message-1' }),
        message({ id: 'message-2' }),
        message({ id: 'message-3' }),
      ],
    });

    fireEvent.click(getMessageLink('message-1'), { ctrlKey: true });
    fireEvent.focus(getMessageLink('message-3'));
    fireEvent.click(getMessageLink('message-3'), { shiftKey: true });

    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('ignores modified E and archives on unmodified E', () => {
    const onArchiveMessage = vi.fn();
    renderMessageList({
      actionCapabilities: ['archive'],
      messages: [message({ id: 'message-1' })],
      onArchiveMessage,
    });

    const link = getMessageLink('message-1');
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.keyDown(link, { key: 'e', ctrlKey: true });
    expect(onArchiveMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(link, { key: 'e' });
    expect(onArchiveMessage).toHaveBeenCalledTimes(1);
  });

  it('marks an all-read selection as unread', () => {
    const onMarkMessageReadState = vi.fn();
    renderMessageList({
      messages: [
        message({ id: 'message-1', isRead: true }),
        message({ id: 'message-2', isRead: true }),
      ],
      onMarkMessageReadState,
    });

    fireEvent.click(getMessageLink('message-1'), { ctrlKey: true });
    fireEvent.click(getMessageLink('message-2'), { ctrlKey: true });
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark selected as unread' }),
    );

    expect(onMarkMessageReadState).toHaveBeenCalledTimes(2);
    const selectedMessageIds = onMarkMessageReadState.mock.calls[0]?.[2];
    expect(selectedMessageIds).toBeInstanceOf(Set);
    expect(onMarkMessageReadState.mock.calls[1]?.[2]).toBe(selectedMessageIds);
    expect([...(selectedMessageIds as Set<string>)]).toEqual([
      'message-1',
      'message-2',
    ]);
    expect(
      onMarkMessageReadState.mock.calls.map(
        ([selectedMessage, isRead]) => [selectedMessage.id, isRead],
      ),
    ).toEqual([
      ['message-1', false],
      ['message-2', false],
    ]);
  });

  it('keeps focus on the list section when a bulk action removes every row', () => {
    const { rerenderMessageList } = renderMessageList({
      messages: [message({ id: 'message-1' }), message({ id: 'message-2' })],
    });

    fireEvent.click(getMessageLink('message-1'), { ctrlKey: true });
    fireEvent.click(getMessageLink('message-2'), { ctrlKey: true });
    fireEvent.click(
      screen.getByRole('button', { name: 'Move selected to trash' }),
    );
    rerenderMessageList({ messages: [] });

    expect(document.activeElement).toBe(
      screen.getByRole('region', { name: 'Inbox message list' }),
    );
  });

  it('clears selection when search scope or externally selected message changes', () => {
    const { rerenderMessageList } = renderMessageList({
      messages: [message({ id: 'message-1' }), message({ id: 'message-2' })],
    });

    fireEvent.click(getMessageLink('message-1'), { ctrlKey: true });
    rerenderMessageList({ searchScope: 'all' });
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();

    fireEvent.click(getMessageLink('message-1'), { ctrlKey: true });
    rerenderMessageList({ selectedMessageId: 'message-2' });
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });
});

type MessageListProps = React.ComponentProps<typeof MessageList>;

function renderMessageList(options: Partial<MessageListProps> = {}) {
  const props = createMessageListProps(options);
  const result = render(
    <TooltipProvider>
      <MessageList {...props} />
    </TooltipProvider>,
  );

  return {
    ...result,
    onArchiveMessage: props.onArchiveMessage,
    onDeleteMessage: props.onDeleteMessage,
    onMoveMessage: props.onMoveMessage,
    onSearch: props.onSearch,
    onSearchScopeChange: props.onSearchScopeChange,
    rerenderMessageList(next: Partial<MessageListProps>) {
      Object.assign(props, next);
      result.rerender(
        <TooltipProvider>
          <MessageList {...props} />
        </TooltipProvider>,
      );
    },
  };
}

function createMessageListProps(
  options: Partial<MessageListProps> = {},
): MessageListProps {
  return {
    folderId: 'inbox',
    folderLabel: 'Inbox',
    folders: [],
    actionCapabilities: [],
    messages: [],
    selectedMessageId: undefined,
    isLoading: false,
    error: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    isActionPending: false,
    onLoadMore: vi.fn(),
    onArchiveMessage: vi.fn(),
    onDeleteMessage: vi.fn(),
    onDragActiveChange: vi.fn(),
    onMarkMessageJunkState: vi.fn(),
    onMarkMessageReadState: vi.fn(),
    onMoveMessage: vi.fn(),
    onForwardMessage: vi.fn(),
    onReplyToMessage: vi.fn(),
    onReplyAllToMessage: vi.fn(),
    onToggleMessageFlag: vi.fn(),
    onToggleMessageImportant: vi.fn(),
    onToggleMessageStar: vi.fn(),
    onSearch: vi.fn(),
    onSearchScopeChange: vi.fn(),
    searchQuery: '',
    searchScope: 'folder',
    ...options,
  };
}

function renderControlledMessageList() {
  function ControlledMessageList() {
    const [searchQuery, setSearchQuery] = useState('');

    return (
      <TooltipProvider>
        <MessageList
          {...createMessageListProps({
            onSearch: setSearchQuery,
            searchQuery,
          })}
        />
      </TooltipProvider>
    );
  }

  render(<ControlledMessageList />);
}

function renderControlledScopeMessageList() {
  function ControlledMessageList() {
    const [searchScope, setSearchScope] = useState<MailSearchScope>('all');

    return (
      <TooltipProvider>
        <MessageList
          {...createMessageListProps({
            onSearchScopeChange: setSearchScope,
            searchScope,
          })}
        />
      </TooltipProvider>
    );
  }

  render(<ControlledMessageList />);
}

function message({
  id,
  folderId = 'inbox',
  isRead = false,
}: {
  id: string;
  folderId?: string;
  isRead?: boolean;
}): MailMessageSummary {
  return {
    id,
    folderId,
    sender: {
      name: `Sender ${id}`,
      email: `${id}@example.com`,
    },
    recipients: [],
    subject: `Subject ${id}`,
    preview: `Preview ${id}`,
    receivedDateTime: '2026-05-16T10:00:00.000Z',
    isRead,
    hasAttachments: false,
    importance: 'normal',
  };
}

function folder({
  id,
  label = id,
  wellKnownName,
}: {
  id: string;
  label?: string;
  wellKnownName?: string;
}): MailFolder {
  return {
    id,
    label,
    icon: 'folder',
    unreadCount: 0,
    totalCount: 0,
    wellKnownName,
    hasChildren: false,
    depth: 0,
  };
}

function getMessageLink(id: string) {
  return screen.getByText(`Subject ${id}`).closest('a')!;
}

function getMessageListScroller() {
  return screen.getByText('Subject message-1').closest('[tabindex="0"]')!;
}
