import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MessageList } from '@/ui/mail/MessageList';

function renderMessageList(onSearch = vi.fn()) {
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
        searchQuery=""
      />
    </TooltipProvider>,
  );

  return { onSearch };
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
});
