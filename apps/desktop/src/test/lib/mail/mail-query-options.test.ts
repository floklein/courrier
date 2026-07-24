import { beforeEach, describe, expect, it, vi } from 'vitest';

function runQueryFn(options: { queryFn?: unknown }, context = {}) {
  expect(typeof options.queryFn).toBe('function');
  return (options.queryFn as (context: never) => unknown)(context as never);
}

function installCourrierApi() {
  const attachments = {
    pickLocal: vi.fn(),
    registerDroppedFiles: vi.fn(),
    open: vi.fn(),
    download: vi.fn(),
  };
  const auth = {
    getSession: vi.fn().mockResolvedValue({ status: 'unauthenticated' }),
    signIn: vi.fn(),
    switchAccount: vi.fn(),
    signOut: vi.fn(),
  };
  const mail = {
    getCapabilities: vi.fn().mockResolvedValue([]),
    listFolders: vi.fn().mockResolvedValue([]),
    listMessages: vi.fn().mockResolvedValue({ messages: [] }),
    searchMessages: vi.fn().mockResolvedValue({ messages: [] }),
    getMessage: vi.fn().mockResolvedValue({ id: 'message-1' }),
    markMessageReadState: vi.fn(),
    moveMessage: vi.fn(),
    deleteMessage: vi.fn(),
    archiveMessage: vi.fn(),
    markMessageJunkState: vi.fn(),
    setMessageStarState: vi.fn(),
    setMessageFlagState: vi.fn(),
    setMessageImportantState: vi.fn(),
    listPeople: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
    replyToMessage: vi.fn(),
    onRemoteChange: vi.fn(),
    onOpenMessage: vi.fn(),
  };
  const notifications = {
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
  };
  const drafts = {
    list: vi.fn().mockResolvedValue([]),
    get: vi.fn(),
    save: vi.fn(),
    delete: vi.fn(),
    send: vi.fn(),
  };
  const windowApi = {
    closeCurrent: vi.fn(),
    getComposeDraft: vi.fn(),
    openComposeWindow: vi.fn(),
  };

  Object.defineProperty(window, 'courrier', {
    configurable: true,
    value: {
      attachments,
      auth,
      drafts,
      mail,
      notifications,
      window: windowApi,
    },
  });

  return { auth, drafts, mail };
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
      'folder',
      '',
    ]);
    expect(options.initialPageParam).toBeUndefined();
    await runQueryFn(options, { pageParam: 'page-2' });
    expect(bridge.mail.listMessages).toHaveBeenCalledWith(
      'account-1',
      'inbox',
      'page-2',
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
      'folder',
      'urgent',
    ]);
    expect(people.queryKey).toEqual(['mail', 'account-1', 'people', 'Ada']);
    await runQueryFn(messages, { pageParam: undefined });
    await runQueryFn(people);
    expect(bridge.mail.searchMessages).toHaveBeenCalledWith('account-1', {
      query: 'urgent',
      scope: 'folder',
      folderId: 'inbox',
      includeSpamTrash: undefined,
      nextPageToken: undefined,
    });
    expect(bridge.mail.listPeople).toHaveBeenCalledWith('account-1', 'Ada');
  });

  it('builds global message search queries', async () => {
    const bridge = installCourrierApi();
    const { mailMessagesQueryOptions } = await import(
      '@/lib/mail/mail-query-options'
    );

    const messages = mailMessagesQueryOptions(
      'account-1',
      'inbox',
      ' urgent ',
      'all',
    );

    expect(messages.queryKey).toEqual([
      'mail',
      'account-1',
      'messages',
      'inbox',
      'all',
      'urgent',
    ]);
    await runQueryFn(messages, { pageParam: 'next-page' });
    expect(bridge.mail.searchMessages).toHaveBeenCalledWith('account-1', {
      query: 'urgent',
      scope: 'all',
      folderId: 'inbox',
      includeSpamTrash: true,
      nextPageToken: 'next-page',
    });
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

  it('builds list and detail draft queries scoped to the account', async () => {
    const bridge = installCourrierApi();
    const {
      mailDraftQueryOptions,
      mailDraftsQueryOptions,
      mailPreloadStaleTimeMs,
    } = await import('@/lib/mail/mail-query-options');

    const listOptions = mailDraftsQueryOptions('google:account-1');
    const detailOptions = mailDraftQueryOptions(
      'google:account-1',
      'draft-1',
    );

    expect(listOptions.queryKey).toEqual([
      'mail',
      'google:account-1',
      'drafts',
    ]);
    expect(detailOptions.queryKey).toEqual([
      'mail',
      'google:account-1',
      'draft',
      'draft-1',
    ]);
    expect(listOptions.staleTime).toBe(mailPreloadStaleTimeMs);
    expect(detailOptions.staleTime).toBe(mailPreloadStaleTimeMs);

    await runQueryFn(listOptions);
    await runQueryFn(detailOptions);

    expect(bridge.drafts.list).toHaveBeenCalledWith('google:account-1');
    expect(bridge.drafts.get).toHaveBeenCalledWith(
      'google:account-1',
      'draft-1',
    );
  });
});
