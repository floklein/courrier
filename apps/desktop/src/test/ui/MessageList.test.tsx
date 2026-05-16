import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { MailSearchScope } from '@/lib/mail-types';
import { MessageList } from '@/ui/mail/MessageList';

function renderMessageList(
  onSearch = vi.fn(),
  {
    onSearchScopeChange = vi.fn(),
    searchScope = 'folder' as MailSearchScope,
  } = {},
) {
  render(
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
    fireEvent.click(screen.getByRole('tab', { name: 'This folder' }));

    expect(onSearchScopeChange).toHaveBeenCalledWith('folder');
  });
});
