import { beforeEach, describe, expect, it, vi } from 'vitest';

function runQueryFn(options: { queryFn?: unknown }, context = {}) {
  expect(typeof options.queryFn).toBe('function');
  return (options.queryFn as (context: never) => unknown)(context as never);
}

function installCourrierApi() {
  const auth = {
    getSession: vi.fn().mockResolvedValue({ status: 'unauthenticated' }),
    signIn: vi.fn(),
    switchAccount: vi.fn(),
    signOut: vi.fn(),
  };
  const mail = {
    listFolders: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue({ messages: [] }),
    getMessage: vi.fn().mockResolvedValue({ id: 'message-1' }),
    markMessageReadState: vi.fn(),
    moveMessage: vi.fn(),
    deleteMessage: vi.fn(),
    listPeople: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
    replyToMessage: vi.fn(),
    onRemoteChange: vi.fn(),
  };
  const windowApi = {
    closeCurrent: vi.fn(),
    getComposeDraft: vi.fn(),
    openComposeWindow: vi.fn(),
  };

  Object.defineProperty(window, 'courrier', {
    configurable: true,
    value: { auth, mail, window: windowApi },
  });

  return { auth, mail };
}

describe('mail query options', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('builds the auth session query', async () => {
    const bridge = installCourrierApi();
    const { authSessionQueryOptions, mailPreloadStaleTimeMs } = await import(
      '@/lib/mail/mail-query-options'
    );

    const options = authSessionQueryOptions();

    expect(options.queryKey).toEqual(['auth', 'session']);
    expect(options.staleTime).toBe(mailPreloadStaleTimeMs);
    await runQueryFn(options);
    expect(bridge.auth.getSession).toHaveBeenCalledOnce();
  });

  it('builds folder and message detail queries scoped to the account', async () => {
    const bridge = installCourrierApi();
    const {
      mailFoldersQueryOptions,
      mailMessageQueryOptions,
      mailPreloadStaleTimeMs,
    } = await import('@/lib/mail/mail-query-options');

    const folderOptions = mailFoldersQueryOptions('account-1');
    const messageOptions = mailMessageQueryOptions(
      'account-1',
      'inbox',
      undefined,
    );

    expect(folderOptions.queryKey).toEqual(['mail', 'account-1', 'folders']);
    expect(messageOptions.queryKey).toEqual([
      'mail',
      'account-1',
      'message',
      'inbox',
      undefined,
    ]);
    expect(folderOptions.staleTime).toBe(mailPreloadStaleTimeMs);
    await runQueryFn(folderOptions);
    await runQueryFn(messageOptions);
    expect(bridge.mail.listFolders).toHaveBeenCalledWith('account-1');
    expect(bridge.mail.getMessage).toHaveBeenCalledWith('account-1', 'inbox', '');
  });

  it('normalizes paged message searches', async () => {
    const bridge = installCourrierApi();
    bridge.mail.listMessages.mockResolvedValue({
      messages: [],
      nextPageToken: 'next-page',
    });
    const { mailMessagesQueryOptions } = await import(
      '@/lib/mail/mail-query-options'
    );

    const options = mailMessagesQueryOptions('account-1', 'inbox');

    expect(options.queryKey).toEqual([
      'mail',
      'account-1',
      'messages',
      'inbox',
      '',
    ]);
    expect(options.initialPageParam).toBeUndefined();
    await runQueryFn(options, { pageParam: 'page-2' });
    expect(bridge.mail.listMessages).toHaveBeenCalledWith(
      'account-1',
      'inbox',
      'page-2',
      undefined,
    );
    expect(
      options.getNextPageParam?.(
        { messages: [], nextPageToken: 'next-page' },
        [],
        undefined,
        [],
      ),
    ).toBe('next-page');
  });

  it('keeps searched message and people queries stable after trimming', async () => {
    const bridge = installCourrierApi();
    const { mailMessagesQueryOptions, mailPeopleQueryOptions } = await import(
      '@/lib/mail/mail-query-options'
    );

    const messages = mailMessagesQueryOptions('account-1', 'inbox', 'urgent');
    const people = mailPeopleQueryOptions('account-1', '  Ada  ');

    expect(messages.queryKey).toEqual([
      'mail',
      'account-1',
      'messages',
      'inbox',
      'urgent',
    ]);
    expect(people.queryKey).toEqual(['mail', 'account-1', 'people', 'Ada']);
    await runQueryFn(messages, { pageParam: undefined });
    await runQueryFn(people);
    expect(bridge.mail.listMessages).toHaveBeenCalledWith(
      'account-1',
      'inbox',
      undefined,
      'urgent',
    );
    expect(bridge.mail.listPeople).toHaveBeenCalledWith('account-1', 'Ada');
  });

  it('passes undefined for empty people queries', async () => {
    const bridge = installCourrierApi();
    const { mailPeopleQueryOptions } = await import(
      '@/lib/mail/mail-query-options'
    );

    const options = mailPeopleQueryOptions('account-1', '   ');

    expect(options.queryKey).toEqual(['mail', 'account-1', 'people', '']);
    await runQueryFn(options);
    expect(bridge.mail.listPeople).toHaveBeenCalledWith('account-1', undefined);
  });
});
