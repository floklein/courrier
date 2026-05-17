import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
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

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 104,
    getVirtualItems: () =>
      Array.from({ length: count }, (_item, index) => ({
        index,
        key: index,
        start: index * 104,
      })),
    measureElement: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();

  return {
    ...actual,
    Link: ({
      children,
      className,
      draggable,
    }: {
      children: ReactNode;
      className?: string;
      draggable?: boolean;
    }) => (
      <a className={className} draggable={draggable} href="/mail/inbox/message-1">
        {children}
      </a>
    ),
  };
});

vi.mock('@/ui/mail/MailActionMenu', () => ({
  MailActionContextContent: (props: { currentFolderId: string }) => {
    mailActionContextContentMock(props);

    return (
      <div data-current-folder-id={props.currentFolderId} data-testid="mail-action-context" />
    );
  },
}));

function renderMessageList(
  onSearch = vi.fn(),
  {
    onSearchScopeChange = vi.fn(),
    searchScope = 'folder' as MailSearchScope,
    folders = [] as MailFolder[],
    messages = [] as MailMessageSummary[],
  } = {},
) {
  render(
    <TooltipProvider>
      <MessageList
        folderId="inbox"
        folderLabel="Inbox"
        folders={folders}
        actionCapabilities={[]}
        messages={messages}
        selectedMessageId={undefined}
        isLoading={false}
        error={null}
        hasNextPage={false}
        isFetchingNextPage={false}
        isActionPending={false}
        onLoadMore={vi.fn()}
        onArchiveMessage={vi.fn()}
        onDeleteMessage={vi.fn()}
        onDragActiveChange={vi.fn()}
        onMarkMessageJunkState={vi.fn()}
        onMarkMessageReadState={vi.fn()}
        onMoveMessage={vi.fn()}
        onReplyToMessage={vi.fn()}
        onToggleMessageFlag={vi.fn()}
        onToggleMessageImportant={vi.fn()}
        onToggleMessageStar={vi.fn()}
        onSearch={onSearch}
        onSearchScopeChange={onSearchScopeChange}
        searchQuery=""
        searchScope={searchScope}
      />
    </TooltipProvider>,
  );

  return { onSearch, onSearchScopeChange };
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
          actionCapabilities={[]}
          messages={[]}
          selectedMessageId={undefined}
          isLoading={false}
          error={null}
          hasNextPage={false}
          isFetchingNextPage={false}
          isActionPending={false}
          onLoadMore={vi.fn()}
          onArchiveMessage={vi.fn()}
          onDeleteMessage={vi.fn()}
          onDragActiveChange={vi.fn()}
          onMarkMessageJunkState={vi.fn()}
          onMarkMessageReadState={vi.fn()}
          onMoveMessage={vi.fn()}
          onReplyToMessage={vi.fn()}
          onToggleMessageFlag={vi.fn()}
          onToggleMessageImportant={vi.fn()}
          onToggleMessageStar={vi.fn()}
          onSearch={handleSearch}
          onSearchScopeChange={vi.fn()}
          searchQuery={searchQuery}
          searchScope="folder"
        />
      </TooltipProvider>
    );
  }

  render(<ControlledMessageList />);

  return { onSearch };
}

function renderControlledScopeMessageList() {
  function ControlledMessageList() {
    const [searchScope, setSearchScope] = useState<MailSearchScope>('all');

    return (
      <TooltipProvider>
        <MessageList
          folderId="inbox"
          folderLabel="Inbox"
          folders={[]}
          actionCapabilities={[]}
          messages={[]}
          selectedMessageId={undefined}
          isLoading={false}
          error={null}
          hasNextPage={false}
          isFetchingNextPage={false}
          isActionPending={false}
          onLoadMore={vi.fn()}
          onArchiveMessage={vi.fn()}
          onDeleteMessage={vi.fn()}
          onDragActiveChange={vi.fn()}
          onMarkMessageJunkState={vi.fn()}
          onMarkMessageReadState={vi.fn()}
          onMoveMessage={vi.fn()}
          onReplyToMessage={vi.fn()}
          onToggleMessageFlag={vi.fn()}
          onToggleMessageImportant={vi.fn()}
          onToggleMessageStar={vi.fn()}
          onSearch={vi.fn()}
          onSearchScopeChange={setSearchScope}
          searchQuery=""
          searchScope={searchScope}
        />
      </TooltipProvider>
    );
  }

  render(<ControlledMessageList />);
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

  it('renders all-mail search tabs and switches scope', () => {
    const onSearchScopeChange = vi.fn();
    renderMessageList(vi.fn(), { onSearchScopeChange, searchScope: 'all' });

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

  it('uses a global search result folder for move destinations', () => {
    const folders = [
      createFolder('inbox', 'Inbox'),
      createFolder('sent', 'Sent'),
      createFolder('archive', 'Archive'),
    ];

    renderMessageList(vi.fn(), {
      folders,
      messages: [
        {
          id: 'message-1',
          folderId: 'sent',
          folderLabel: 'Sent',
          sender: { name: 'Ada', email: 'ada@example.com' },
          recipients: [],
          subject: 'Global result',
          preview: 'Found outside the current folder',
          receivedDateTime: '2026-05-16T10:00:00.000Z',
          isRead: true,
          hasAttachments: false,
          importance: 'normal',
        },
      ],
      searchScope: 'all',
    });

    fireEvent.contextMenu(screen.getByText('Global result'));

    expect(screen.getByTestId('mail-action-context')).toHaveAttribute(
      'data-current-folder-id',
      'sent',
    );
    expect(mailActionContextContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ currentFolderId: 'sent' }),
    );
  });
});

function createFolder(id: string, label: string): MailFolder {
  return {
    id,
    label,
    icon: 'folder',
    unreadCount: 0,
    totalCount: 0,
    hasChildren: false,
    depth: 0,
  };
}
