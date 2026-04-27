import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import {
  Archive,
  ArrowLeft,
  Check,
  ChevronsUpDown,
  Clock,
  FileText,
  Inbox,
  Loader2,
  LogOut,
  Mail,
  Monitor,
  MoreHorizontal,
  Moon,
  Paperclip,
  Reply,
  Search,
  Send,
  Star,
  Sun,
  Trash2,
} from 'lucide-react';
import { useEffect, type ComponentType, type ReactNode } from 'react';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { ScrollArea } from '../components/ui/scroll-area';
import { Separator } from '../components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import { api } from '../lib/api-client';
import type {
  AuthSession,
  FolderIcon,
  MailFolder,
  MailMessageDetail,
  MailMessageSummary,
  PagedMessages,
} from '../lib/mail-types';
import { decodeRouteId, encodeRouteId } from '../lib/route-ids';
import { cn } from '../lib/utils';
import { useTheme } from '../theme/ThemeProvider';

const folderIcons: Record<FolderIcon, ComponentType<{ className?: string }>> = {
  inbox: Inbox,
  send: Send,
  file: FileText,
  archive: Archive,
  trash: Trash2,
  star: Star,
  clock: Clock,
};

function parseMailPath(pathname: string) {
  const parts = pathname.split('/').filter(Boolean);

  return {
    folderId:
      parts[0] === 'mail' && parts[1]
        ? decodeRouteId(parts[1]) ?? 'inbox'
        : 'inbox',
    messageId: parts[0] === 'mail' ? decodeRouteId(parts[2]) : undefined,
  };
}

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function MailClient() {
  const sessionQuery = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: api.auth.getSession,
  });

  if (sessionQuery.isPending) {
    return <FullScreenStatus label="Checking Microsoft session..." />;
  }

  if (sessionQuery.isError) {
    return (
      <Onboarding
        session={{
          status: 'configuration-error',
          message: sessionQuery.error.message,
        }}
      />
    );
  }

  if (sessionQuery.data.status !== 'authenticated') {
    return <Onboarding session={sessionQuery.data} />;
  }

  return <AuthenticatedMailClient session={sessionQuery.data} />;
}

function AuthenticatedMailClient({
  session,
}: {
  session: Extract<AuthSession, { status: 'authenticated' }>;
}) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const { folderId, messageId } = parseMailPath(pathname);
  const foldersQuery = useQuery({
    queryKey: ['mail', 'folders'],
    queryFn: api.mail.listFolders,
  });
  const folders = (foldersQuery.data ?? []) as MailFolder[];
  const currentFolder =
    folders.find((folder) => folder.id === folderId) ??
    folders.find((folder) => folder.wellKnownName === folderId) ??
    folders[0];
  const resolvedFolderId = currentFolder?.id ?? folderId;
  const messagesQuery = useInfiniteQuery({
    queryKey: ['mail', 'messages', resolvedFolderId],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.mail.listMessages(resolvedFolderId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PagedMessages) => lastPage.nextPageUrl,
    enabled: Boolean(currentFolder),
  });
  const messages =
    messagesQuery.data?.pages.flatMap((page: PagedMessages) => page.messages) ??
    [];
  const messageQuery = useQuery({
    queryKey: ['mail', 'message', resolvedFolderId, messageId],
    queryFn: () => api.mail.getMessage(resolvedFolderId, messageId ?? ''),
    enabled: Boolean(currentFolder && messageId),
  });
  const selectedMessage = messageQuery.data as MailMessageDetail | undefined;
  const isReadingMessage = Boolean(messageId);

  useEffect(() => {
    if (!currentFolder || messageId || !messages[0]) {
      return;
    }

    navigate({
      to: '/mail/$folderId/$messageId',
      params: {
        folderId: encodeRouteId(resolvedFolderId),
        messageId: encodeRouteId(messages[0].id),
      },
      replace: true,
    });
  }, [currentFolder, messageId, messages, navigate, resolvedFolderId]);

  return (
    <TooltipProvider delayDuration={200}>
      <main className="grid h-full min-h-0 grid-cols-[240px_minmax(320px,420px)_minmax(0,1fr)] bg-background max-lg:grid-cols-[76px_minmax(300px,380px)_minmax(0,1fr)] max-md:grid-cols-[72px_minmax(0,1fr)]">
        <FolderRail
          accountEmail={session.account.username}
          accountName={session.account.name ?? session.account.username}
          currentFolderId={resolvedFolderId}
          folders={folders}
          isLoading={foldersQuery.isPending}
          error={foldersQuery.error as Error | null}
          className={cn(isReadingMessage && 'max-md:hidden')}
        />
        <MessageList
          folderId={resolvedFolderId}
          folderLabel={currentFolder?.label ?? 'Inbox'}
          messages={messages}
          selectedMessageId={messageId}
          isLoading={messagesQuery.isPending || foldersQuery.isPending}
          error={messagesQuery.error as Error | null}
          hasNextPage={Boolean(messagesQuery.hasNextPage)}
          isFetchingNextPage={messagesQuery.isFetchingNextPage}
          onLoadMore={() => {
            void messagesQuery.fetchNextPage();
          }}
          className={cn(isReadingMessage && 'max-md:hidden')}
        />
        <ReadingPane
          folderId={resolvedFolderId}
          message={selectedMessage}
          isLoading={messageQuery.isPending && Boolean(messageId)}
          error={messageQuery.error as Error | null}
          className={cn(isReadingMessage && 'max-md:col-span-2')}
        />
      </main>
    </TooltipProvider>
  );
}

function Onboarding({ session }: { session: Exclude<AuthSession, { status: 'authenticated' }> }) {
  const queryClient = useQueryClient();
  const signInMutation = useMutation({
    mutationFn: api.auth.signIn,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      await queryClient.invalidateQueries({ queryKey: ['mail'] });
    },
  });
  const isConfigError = session.status === 'configuration-error';

  return (
    <main className="flex h-full items-center justify-center bg-background p-6">
      <section className="w-full max-w-md rounded-lg border bg-card p-8 shadow-sm">
        <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Mail className="size-5" />
        </div>
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Connect Outlook
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Courrier needs Microsoft access before it can show your folders and
          messages. Sign in opens Microsoft in your system browser.
        </p>
        {isConfigError && (
          <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-6 text-destructive">
            {session.message}
          </div>
        )}
        {signInMutation.isError && (
          <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm leading-6 text-destructive">
            {signInMutation.error.message}
          </div>
        )}
        <Button
          className="mt-6 w-full"
          disabled={signInMutation.isPending || isConfigError}
          onClick={() => signInMutation.mutate()}
        >
          {signInMutation.isPending && <Loader2 className="size-4 animate-spin" />}
          Sign in with Microsoft
        </Button>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">
          Setup instructions are in docs/oauth.md.
        </p>
      </section>
    </main>
  );
}

function FolderRail({
  accountEmail,
  accountName,
  currentFolderId,
  folders,
  isLoading,
  error,
  className,
}: {
  accountEmail: string;
  accountName: string;
  currentFolderId: string;
  folders: MailFolder[];
  isLoading: boolean;
  error: Error | null;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const signOutMutation = useMutation({
    mutationFn: api.auth.signOut,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ['mail'] });
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
  });

  return (
    <aside
      className={cn('flex min-h-0 flex-col border-r bg-card/70', className)}
    >
      <div className="flex h-16 items-center gap-3 px-5 max-lg:justify-center max-lg:px-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Mail className="size-4" />
        </div>
        <div className="flex min-w-0 max-lg:hidden">
          <span className="truncate text-sm font-semibold tracking-tight">
            Courrier
          </span>
        </div>
      </div>
      <Separator />
      <nav className="flex flex-1 flex-col gap-1 overflow-hidden p-2">
        {isLoading && <RailStatus label="Loading folders" />}
        {!isLoading && error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive max-lg:hidden">
            {error.message}
          </div>
        )}
        {!isLoading &&
          !error &&
          folders.map((folder) => {
            const Icon = folderIcons[folder.icon];
            const isActive = folder.id === currentFolderId;

            return (
              <Link
                key={folder.id}
                to="/mail/$folderId"
                params={{ folderId: encodeRouteId(folder.id) }}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground max-lg:justify-center max-lg:px-0',
                  isActive && 'bg-accent text-accent-foreground',
                )}
                style={{ paddingLeft: folder.depth ? 8 + folder.depth * 14 : undefined }}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate max-lg:hidden">{folder.label}</span>
                {folder.unreadCount > 0 && (
                  <Badge
                    variant={isActive ? 'default' : 'secondary'}
                    className="ml-auto max-lg:hidden"
                  >
                    {folder.unreadCount}
                  </Badge>
                )}
              </Link>
            );
          })}
      </nav>
      <div className="border-t p-2">
        <UserMenu
          accountEmail={accountEmail}
          accountName={accountName}
          isSigningOut={signOutMutation.isPending}
          onSignOut={() => signOutMutation.mutate()}
        />
      </div>
    </aside>
  );
}

function UserMenu({
  accountEmail,
  accountName,
  isSigningOut,
  onSignOut,
}: {
  accountEmail: string;
  accountName: string;
  isSigningOut: boolean;
  onSignOut: () => void;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-12 w-full justify-start gap-2 px-2 max-lg:size-10 max-lg:justify-center max-lg:px-0"
          aria-label="User menu"
        >
          <Avatar className="size-8 max-lg:size-6">
            <AvatarFallback>{initials(accountName)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col items-start max-lg:hidden">
            <span className="truncate text-sm font-semibold leading-5">
              {accountName}
            </span>
            <span className="truncate text-xs font-normal leading-4 text-muted-foreground">
              {accountEmail}
            </span>
          </span>
          <ChevronsUpDown data-icon="inline-end" className="ml-auto max-lg:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" className="w-72 p-0">
        <DropdownMenuLabel className="flex items-center gap-3 p-3">
          <Avatar className="size-9">
            <AvatarFallback>{initials(accountName)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-semibold">{accountName}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">
              {accountEmail}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="m-0" />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-3 py-2 text-xs font-normal text-muted-foreground">
            Theme
          </DropdownMenuLabel>
          <ThemeMenuItem
            icon={Sun}
            isSelected={theme === 'light'}
            label="Light"
            onSelect={() => setTheme('light')}
          />
          <ThemeMenuItem
            icon={Moon}
            isSelected={theme === 'dark'}
            label="Dark"
            onSelect={() => setTheme('dark')}
          />
          <ThemeMenuItem
            icon={Monitor}
            isSelected={theme === 'system'}
            label="System"
            onSelect={() => setTheme('system')}
          />
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={isSigningOut}
            onSelect={onSignOut}
            className="m-1 px-3 py-2"
          >
            {isSigningOut ? (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            ) : (
              <LogOut data-icon="inline-start" />
            )}
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeMenuItem({
  icon: Icon,
  isSelected,
  label,
  onSelect,
}: {
  icon: ComponentType<{ className?: string; 'data-icon'?: string }>;
  isSelected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onSelect={onSelect} className="mx-1 px-3 py-2">
      <Icon data-icon="inline-start" />
      {label}
      {isSelected && <Check data-icon="inline-end" className="ml-auto" />}
    </DropdownMenuItem>
  );
}

function MessageList({
  folderId,
  folderLabel,
  messages,
  selectedMessageId,
  isLoading,
  error,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  className,
}: {
  folderId: string;
  folderLabel: string;
  messages: MailMessageSummary[];
  selectedMessageId: string | undefined;
  isLoading: boolean;
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden border-r bg-card max-md:border-r-0',
        className,
      )}
    >
      <header className="flex h-16 items-center justify-between gap-3 px-5">
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Search mail">
              <Search data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Search mail</TooltipContent>
        </Tooltip>
      </header>
      <Separator />
      {isLoading && <PanelStatus label="Loading messages..." />}
      {!isLoading && error && <PanelStatus label={error.message} />}
      {!isLoading && !error && messages.length > 0 && (
        <ScrollArea className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="flex w-full min-w-0 max-w-full flex-col overflow-hidden">
            {messages.map((message) => {
              const isSelected = message.id === selectedMessageId;

              return (
                <Link
                  key={message.id}
                  to="/mail/$folderId/$messageId"
                  params={{
                    folderId: encodeRouteId(folderId),
                    messageId: encodeRouteId(message.id),
                  }}
                  className={cn(
                    'group block min-w-0 overflow-hidden border-b px-3 py-3 transition-colors hover:bg-accent/70',
                    isSelected && 'bg-accent',
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <Avatar className="size-9">
                      <AvatarFallback>
                        {initials(message.sender.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <p
                          className={cn(
                            'min-w-0 truncate text-sm',
                            !message.isRead && 'font-semibold',
                          )}
                        >
                          {message.sender.name}
                        </p>
                        {message.hasAttachments && (
                          <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {formatDate(message.receivedDateTime, 'short')}
                        </span>
                      </div>
                      <p
                        className={cn(
                          'mt-1 truncate text-sm text-foreground',
                          !message.isRead && 'font-medium',
                        )}
                      >
                        {message.subject}
                      </p>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                        {message.preview}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
            {hasNextPage && (
              <Button
                variant="ghost"
                className="m-2"
                disabled={isFetchingNextPage}
                onClick={onLoadMore}
              >
                {isFetchingNextPage && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                Load more
              </Button>
            )}
          </div>
        </ScrollArea>
      )}
      {!isLoading && !error && messages.length === 0 && (
        <EmptyFolder />
      )}
    </section>
  );
}

function ReadingPane({
  folderId,
  message,
  isLoading,
  error,
  className,
}: {
  folderId: string;
  message: MailMessageDetail | undefined;
  isLoading: boolean;
  error: Error | null;
  className?: string;
}) {
  if (isLoading) {
    return (
      <section
        className={cn(
          'flex min-h-0 min-w-0 flex-col bg-background',
          className,
        )}
      >
        <PanelStatus label="Loading message..." />
      </section>
    );
  }

  if (error) {
    return (
      <section
        className={cn(
          'flex min-h-0 min-w-0 flex-col bg-background',
          className,
        )}
      >
        <PanelStatus label={error.message} />
      </section>
    );
  }

  if (!message) {
    return (
      <section
        className={cn(
          'flex min-h-0 min-w-0 flex-col bg-background max-md:hidden',
          className,
        )}
      >
        <PanelStatus label="Select a message" />
      </section>
    );
  }

  const sanitizedBody = DOMPurify.sanitize(message.bodyContent, {
    USE_PROFILES: { html: true },
  });

  return (
    <article
      className={cn('flex min-h-0 min-w-0 flex-col bg-background', className)}
    >
      <header className="flex min-h-16 items-center justify-between gap-4 border-b px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back to message list"
                className="hidden shrink-0 max-md:inline-flex"
                asChild
              >
                <Link
                  to="/mail/$folderId"
                  params={{ folderId: encodeRouteId(folderId) }}
                >
                  <ArrowLeft data-icon="inline-start" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to message list</TooltipContent>
          </Tooltip>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {formatDate(message.receivedDateTime, 'long')}
            </p>
            <h2 className="truncate text-lg font-semibold tracking-tight">
              {message.subject}
            </h2>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton label="Reply">
            <Reply data-icon="inline-start" />
          </ToolbarButton>
          <ToolbarButton label="Archive">
            <Archive data-icon="inline-start" />
          </ToolbarButton>
          <ToolbarButton label="More actions">
            <MoreHorizontal data-icon="inline-start" />
          </ToolbarButton>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex w-full flex-col">
          <div className="flex items-start gap-4 border-b px-4 py-4">
            <Avatar className="size-11">
              <AvatarFallback>{initials(message.sender.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{message.sender.name}</p>
                {message.sender.email && (
                  <span className="text-sm text-muted-foreground">
                    {message.sender.email}
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                To {message.recipients.join(', ') || 'undisclosed recipients'}
              </p>
            </div>
            <Badge variant={message.isRead ? 'secondary' : 'default'}>
              {message.isRead ? 'Read' : 'Unread'}
            </Badge>
          </div>

          <div className="px-4 py-4">
            {message.bodyContentType === 'text' ? (
              <pre className="whitespace-pre-wrap font-sans text-sm leading-7 text-card-foreground">
                {message.bodyContent}
              </pre>
            ) : (
              <div
                className="prose prose-sm max-w-none text-card-foreground [&_*]:max-w-full"
                dangerouslySetInnerHTML={{ __html: sanitizedBody }}
              />
            )}
          </div>
        </div>
      </ScrollArea>
    </article>
  );
}

function ToolbarButton({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function EmptyFolder() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-64 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
          <Inbox className="size-5 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-sm font-semibold">No messages here</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This Outlook folder does not have any messages to show.
        </p>
      </div>
    </div>
  );
}

function FullScreenStatus({ label }: { label: string }) {
  return (
    <main className="flex h-full items-center justify-center bg-background p-8">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {label}
      </div>
    </main>
  );
}

function PanelStatus({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function RailStatus({ label }: { label: string }) {
  return (
    <div className="flex h-10 items-center gap-2 rounded-md px-3 text-xs text-muted-foreground max-lg:justify-center max-lg:px-0">
      <Loader2 className="size-3.5 animate-spin" />
      <span className="max-lg:hidden">{label}</span>
    </div>
  );
}

function formatDate(value: string, style: 'short' | 'long') {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: style === 'short' ? 'medium' : 'full',
    timeStyle: style === 'short' ? undefined : 'short',
  }).format(date);
}
