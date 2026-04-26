import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Archive,
  ArrowLeft,
  Clock,
  FileText,
  Inbox,
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
import { ScrollArea } from '../components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Separator } from '../components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../components/ui/tooltip';
import {
  type FolderIcon,
  getFolder,
  getMessage,
  getMessagesForFolder,
  mailFolders,
} from '../data/mail';
import { cn } from '../lib/utils';
import { type ThemePreference, useTheme } from '../theme/ThemeProvider';

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
    folderId: parts[0] === 'mail' && parts[1] ? parts[1] : 'inbox',
    messageId: parts[0] === 'mail' ? parts[2] : undefined,
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
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const navigate = useNavigate();
  const { folderId, messageId } = parseMailPath(pathname);
  const currentFolder = getFolder(folderId) ?? mailFolders[0];
  const messages = getMessagesForFolder(currentFolder.id);
  const selectedMessage = getMessage(currentFolder.id, messageId);
  const isReadingMessage = Boolean(selectedMessage);

  useEffect(() => {
    if (!messageId && messages[0]) {
      navigate({
        to: '/mail/$folderId/$messageId',
        params: {
          folderId: currentFolder.id,
          messageId: messages[0].id,
        },
        replace: true,
      });
    }
  }, [currentFolder.id, messageId, messages, navigate]);

  return (
    <TooltipProvider delayDuration={200}>
      <main className="grid h-full min-h-0 grid-cols-[220px_minmax(300px,380px)_minmax(0,1fr)] bg-background max-lg:grid-cols-[76px_minmax(280px,360px)_minmax(0,1fr)] max-md:grid-cols-[72px_minmax(0,1fr)]">
        <FolderRail
          currentFolderId={currentFolder.id}
          className={cn(isReadingMessage && 'max-md:hidden')}
        />
        <MessageList
          folderId={currentFolder.id}
          folderLabel={currentFolder.label}
          messages={messages}
          selectedMessageId={selectedMessage?.id}
          className={cn(isReadingMessage && 'max-md:hidden')}
        />
        <ReadingPane
          folderId={currentFolder.id}
          message={selectedMessage}
          className={cn(isReadingMessage && 'max-md:col-span-2')}
        />
      </main>
    </TooltipProvider>
  );
}

function FolderRail({
  currentFolderId,
  className,
}: {
  currentFolderId: string;
  className?: string;
}) {
  return (
    <aside
      className={cn('flex min-h-0 flex-col border-r bg-card/70', className)}
    >
      <div className="flex h-16 items-center gap-3 px-5 max-lg:justify-center max-lg:px-3">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Mail className="size-4" />
        </div>
        <div className="flex flex-col max-lg:hidden">
          <span className="text-sm font-semibold tracking-tight">Courrier</span>
          <span className="text-xs text-muted-foreground">Local mailbox</span>
        </div>
      </div>
      <Separator />
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {mailFolders.map((folder) => {
          const Icon = folderIcons[folder.icon];
          const isActive = folder.id === currentFolderId;

          return (
            <Link
              key={folder.id}
              to="/mail/$folderId"
              params={{ folderId: folder.id }}
              className={cn(
                'flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground max-lg:justify-center max-lg:px-0',
                isActive && 'bg-accent text-accent-foreground',
              )}
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
      <div className="border-t p-3">
        <div className="flex flex-col gap-3">
          <ThemeSelect />
          <div className="rounded-md bg-muted px-3 py-2 max-lg:hidden">
            <p className="text-xs font-medium">Fake data</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Folder and message state is local for this first version.
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}

function ThemeSelect() {
  const { theme, setTheme } = useTheme();

  return (
    <Select
      value={theme}
      onValueChange={(value) => setTheme(value as ThemePreference)}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <SelectTrigger
            size="sm"
            aria-label="Color theme"
            className="w-full max-lg:size-10 max-lg:justify-center max-lg:px-0 max-lg:[&_[data-slot=select-value]]:hidden"
          >
            <SelectValue />
          </SelectTrigger>
        </TooltipTrigger>
        <TooltipContent>Color theme</TooltipContent>
      </Tooltip>
      <SelectContent>
        <SelectGroup>
          <SelectItem value="light">
            <Sun />
            Light
          </SelectItem>
          <SelectItem value="dark">
            <Moon />
            Dark
          </SelectItem>
          <SelectItem value="system">
            <Monitor />
            System
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function MessageList({
  folderId,
  folderLabel,
  messages,
  selectedMessageId,
  className,
}: {
  folderId: string;
  folderLabel: string;
  messages: ReturnType<typeof getMessagesForFolder>;
  selectedMessageId: string | undefined;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col border-r bg-card max-md:border-r-0',
        className,
      )}
    >
      <header className="flex h-16 items-center justify-between gap-3 px-5">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {folderLabel}
          </h1>
          <p className="text-xs text-muted-foreground">
            {messages.length} {messages.length === 1 ? 'message' : 'messages'}
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
      {messages.length > 0 ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col p-2">
            {messages.map((message) => {
              const isSelected = message.id === selectedMessageId;

              return (
                <Link
                  key={message.id}
                  to="/mail/$folderId/$messageId"
                  params={{
                    folderId,
                    messageId: message.id,
                  }}
                  className={cn(
                    'group rounded-md border border-transparent px-3 py-3 transition-colors hover:bg-accent/70',
                    isSelected && 'border-border bg-accent',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Avatar className="size-9">
                      <AvatarFallback>
                        {initials(message.sender.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p
                          className={cn(
                            'truncate text-sm',
                            !message.read && 'font-semibold',
                          )}
                        >
                          {message.sender.name}
                        </p>
                        {message.starred && (
                          <Star className="size-3.5 shrink-0 fill-primary text-primary" />
                        )}
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          {message.date.replace(', 2026', '')}
                        </span>
                      </div>
                      <p
                        className={cn(
                          'mt-1 truncate text-sm text-foreground',
                          !message.read && 'font-medium',
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
          </div>
        </ScrollArea>
      ) : (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-64 text-center">
            <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
              <Inbox className="size-5 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-sm font-semibold">No messages here</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              This folder is empty in the fake mailbox data.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function ReadingPane({
  folderId,
  message,
  className,
}: {
  folderId: string;
  message: ReturnType<typeof getMessage>;
  className?: string;
}) {
  if (!message) {
    return (
      <section
        className={cn(
          'flex min-h-0 flex-col bg-background max-md:hidden',
          className,
        )}
      >
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-72 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
              <Mail className="size-5 text-muted-foreground" />
            </div>
            <h2 className="mt-4 text-sm font-semibold">Select a message</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Choose a message from the list to preview the full conversation.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <article
      className={cn(
        'flex min-h-0 flex-col bg-background max-md:hidden',
        className,
      )}
    >
      <header className="flex min-h-16 items-center justify-between gap-4 border-b px-6">
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
                <Link to="/mail/$folderId" params={{ folderId }}>
                  <ArrowLeft data-icon="inline-start" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Back to message list</TooltipContent>
          </Tooltip>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              {message.date}
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
          <ToolbarButton label={message.starred ? 'Starred' : 'Star'}>
            <Star data-icon="inline-start" />
          </ToolbarButton>
          <ToolbarButton label="More actions">
            <MoreHorizontal data-icon="inline-start" />
          </ToolbarButton>
        </div>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-7">
          <div className="flex items-start gap-4">
            <Avatar className="size-11">
              <AvatarFallback>{initials(message.sender.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">{message.sender.name}</p>
                <span className="text-sm text-muted-foreground">
                  {message.sender.email}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                To {message.recipients.join(', ')}
              </p>
            </div>
            <Badge variant={message.read ? 'secondary' : 'default'}>
              {message.read ? 'Read' : 'Unread'}
            </Badge>
          </div>

          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Paperclip className="size-3.5" />
              Conversation preview
            </div>
            <div className="mt-5 flex flex-col gap-4 text-sm leading-7 text-card-foreground">
              {message.body.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
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
