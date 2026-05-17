import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MailFolder, MailMessageSummary } from '@/lib/mail-types';
import { MessageList } from '@/ui/mail/MessageList';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a href="#message" onClick={onClick}>
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
    scrollToIndex: () => undefined,
  }),
}));

function renderMessageList({
  folders = [],
  isActionPending = false,
  messages = [],
  onDeleteMessage = vi.fn(),
  onMoveMessage = vi.fn(),
  onSearch = vi.fn(),
}: Partial<MessageListProps> = {}) {
  const result = render(
    <TooltipProvider>
      <MessageList
        folderId="inbox"
        folderLabel="Inbox"
        folders={folders}
        messages={messages}
        selectedMessageId={undefined}
        isLoading={false}
        error={null}
        hasNextPage={false}
        isFetchingNextPage={false}
        isActionPending={isActionPending}
        onLoadMore={vi.fn()}
        onDeleteMessage={onDeleteMessage}
        onDragActiveChange={vi.fn()}
        onMarkMessageReadState={vi.fn()}
        onMoveMessage={onMoveMessage}
        onReplyToMessage={vi.fn()}
        onSearch={onSearch}
        searchQuery=""
      />
    </TooltipProvider>,
  );

  return { ...result, onDeleteMessage, onMoveMessage, onSearch };
}

function renderControlledMessageList(onSearch = vi.fn()) {
  function ControlledMessageList() {
    const [searchQuery, setSearchQuery] = useState('');

    function handleSearch(query: string) {
      onSearch(query);
      setSearchQuery(query);
    }

    return (
      <TooltipProvider>
        <MessageList
          folderId="inbox"
          folderLabel="Inbox"
          folders={[]}
          messages={[]}
          selectedMessageId={undefined}
          isLoading={false}
          error={null}
          hasNextPage={false}
          isFetchingNextPage={false}
          isActionPending={false}
          onLoadMore={vi.fn()}
          onDeleteMessage={vi.fn()}
          onDragActiveChange={vi.fn()}
          onMarkMessageReadState={vi.fn()}
          onMoveMessage={vi.fn()}
          onReplyToMessage={vi.fn()}
          onSearch={handleSearch}
          searchQuery={searchQuery}
        />
      </TooltipProvider>
    );
  }

  render(<ControlledMessageList />);

  return { onSearch };
}

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
    const { onSearch } = renderControlledMessageList();

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

    expect(onSearch).toHaveBeenLastCalledWith('');
    expect(screen.getByLabelText('Search Inbox')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('drops bulk selection when selected messages leave the current list', () => {
    const { rerender } = renderMessageList({
      messages: [message({ id: 'message-1' }), message({ id: 'message-2' })],
    });

    fireEvent.click(getMessageLink('message-1'), {
      ctrlKey: true,
    });

    expect(screen.getByText('1 selected')).toBeInTheDocument();

    rerender(
      <TooltipProvider>
        <MessageList
          folderId="inbox"
          folderLabel="Inbox"
          folders={[]}
          messages={[message({ id: 'message-2' })]}
          selectedMessageId={undefined}
          isLoading={false}
          error={null}
          hasNextPage={false}
          isFetchingNextPage={false}
          isActionPending={false}
          onLoadMore={vi.fn()}
          onDeleteMessage={vi.fn()}
          onDragActiveChange={vi.fn()}
          onMarkMessageReadState={vi.fn()}
          onMoveMessage={vi.fn()}
          onReplyToMessage={vi.fn()}
          onSearch={vi.fn()}
          searchQuery=""
        />
      </TooltipProvider>,
    );

    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });

  it('archives only messages still present in the current bulk selection', () => {
    const onMoveMessage = vi.fn();
    renderMessageList({
      folders: [folder({ id: 'archive', wellKnownName: 'archive' })],
      messages: [message({ id: 'message-1' }), message({ id: 'message-2' })],
      onMoveMessage,
    });

    fireEvent.click(getMessageLink('message-1'), {
      ctrlKey: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }));

    expect(onMoveMessage).toHaveBeenCalledTimes(1);
    const removedMessageIds = onMoveMessage.mock.calls[0]?.[2];

    expect(removedMessageIds).toBeInstanceOf(Set);
    if (!(removedMessageIds instanceof Set)) {
      throw new Error('Expected bulk archive to include selected message ids.');
    }

    expect(onMoveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'message-1' }),
      'archive',
      removedMessageIds,
    );
    expect([...removedMessageIds]).toEqual(['message-1']);
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });

  it('suppresses keyboard bulk actions while an action is pending', () => {
    const onDeleteMessage = vi.fn();
    renderMessageList({
      isActionPending: true,
      messages: [message({ id: 'message-1' })],
      onDeleteMessage,
    });

    fireEvent.click(getMessageLink('message-1'), {
      ctrlKey: true,
    });
    fireEvent.keyDown(getMessageListScroller(), { key: 'Delete' });

    expect(onDeleteMessage).not.toHaveBeenCalled();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('uses a normal row click as the starting point for keyboard range selection', () => {
    const onMoveMessage = vi.fn();
    renderMessageList({
      folders: [folder({ id: 'archive', wellKnownName: 'archive' })],
      messages: [
        message({ id: 'message-1' }),
        message({ id: 'message-2' }),
        message({ id: 'message-3' }),
      ],
      onMoveMessage,
    });

    fireEvent.click(getMessageLink('message-2'));
    fireEvent.keyDown(getMessageListScroller(), {
      key: 'ArrowDown',
      shiftKey: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Archive selected' }));

    expect(onMoveMessage).toHaveBeenCalledTimes(2);
    expect(onMoveMessage.mock.calls.map(([message]) => message.id)).toEqual([
      'message-2',
      'message-3',
    ]);
    const removedMessageIds = onMoveMessage.mock.calls[0]?.[2];

    expect(removedMessageIds).toBeInstanceOf(Set);
    if (!(removedMessageIds instanceof Set)) {
      throw new Error('Expected keyboard range archive to include selected message ids.');
    }
    expect([...removedMessageIds]).toEqual([
      'message-2',
      'message-3',
    ]);
  });
});

type MessageListProps = React.ComponentProps<typeof MessageList>;

function message({
  id,
  folderId = 'inbox',
}: {
  id: string;
  folderId?: string;
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
    isRead: false,
    hasAttachments: false,
    importance: 'normal',
  };
}

function folder({
  id,
  wellKnownName,
}: {
  id: string;
  wellKnownName?: string;
}): MailFolder {
  return {
    id,
    label: id,
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
