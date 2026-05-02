import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { invalidateRemoteMailUpdate } from '../../lib/remote-mail-updates';

describe('invalidateRemoteMailUpdate', () => {
  it('invalidates folder, message list, and selected message queries', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    await invalidateRemoteMailUpdate(queryClient, {
      id: 'event-1',
      clientId: 'desktop-1',
      subscriptionId: 'subscription-1',
      kind: 'message-change',
      changeType: 'updated',
      messageId: 'message-1',
      receivedAt: '2026-04-29T10:00:00.000Z',
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['mail', 'folders'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['mail', 'messages'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['mail', 'message'],
    });
  });

  it('invalidates message detail queries for lifecycle updates without a message id', async () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    await invalidateRemoteMailUpdate(queryClient, {
      id: 'event-2',
      clientId: 'desktop-1',
      subscriptionId: 'subscription-1',
      kind: 'lifecycle',
      changeType: 'subscriptionRemoved',
      receivedAt: '2026-04-29T10:00:00.000Z',
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['mail', 'message'],
    });
  });
});
