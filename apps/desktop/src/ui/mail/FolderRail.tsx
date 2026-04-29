import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { PenLine } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ScrollArea } from '../../components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip';
import { api } from '../../lib/api-client';
import { isMailMessageDragData } from '../../lib/mail/mail-drag';
import { folderIcons } from '../../lib/mail/mail-icons';
import type { MailFolder, MailMessageSummary } from '../../lib/mail-types';
import { encodeRouteId } from '../../lib/route-ids';
import { cn } from '../../lib/utils';
import { RailStatus } from '../app/StatusViews';
import { UserMenu } from '../primitives/UserMenu';

export function FolderRail({
  accountEmail,
  accountName,
  currentFolderId,
  folders,
  isLoading,
  error,
  isActionPending,
  onComposeMessage,
  onMoveMessage,
  className,
}: {
  accountEmail: string;
  accountName: string;
  currentFolderId: string;
  folders: MailFolder[];
  isLoading: boolean;
  error: Error | null;
  isActionPending: boolean;
  onComposeMessage: () => void;
  onMoveMessage: (
    message: MailMessageSummary,
    destinationFolderId: string,
  ) => void;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const signOutMutation = useMutation({
    mutationFn: api.auth.signOut,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ['mail'] });
      queryClient.removeQueries({ queryKey: ['mail'] });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
    },
  });

  return (
    <aside
      className={cn('flex min-h-0 flex-col border-r bg-card/70', className)}
    >
      <div className="app-window-header app-window-controls-start flex h-16 shrink-0 items-center justify-between gap-2 border-b px-3 max-lg:justify-center max-lg:px-2">
        <div className="flex min-w-0 max-lg:hidden">
          <span className="truncate text-sm font-semibold tracking-tight">
            Courrier
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon-sm"
              aria-label="Compose mail"
              disabled={isActionPending}
              onClick={onComposeMessage}
            >
              <PenLine data-icon="inline-start" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Compose mail</TooltipContent>
        </Tooltip>
      </div>
      <ScrollArea className="min-h-0 flex-1 overflow-hidden">
        <nav className="flex flex-col gap-1 p-2">
          {isLoading && <RailStatus label="Loading folders" />}
          {!isLoading && error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive max-lg:hidden">
              {error.message}
            </div>
          )}
          {!isLoading &&
            !error &&
            folders.map((folder) => (
              <FolderRailItem
                key={folder.id}
                currentFolderId={currentFolderId}
                folder={folder}
                isActionPending={isActionPending}
                onMoveMessage={onMoveMessage}
              />
            ))}
        </nav>
      </ScrollArea>
      <div className="shrink-0 border-t p-2 max-lg:flex max-lg:justify-center">
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

function FolderRailItem({
  currentFolderId,
  folder,
  isActionPending,
  onMoveMessage,
}: {
  currentFolderId: string;
  folder: MailFolder;
  isActionPending: boolean;
  onMoveMessage: (
    message: MailMessageSummary,
    destinationFolderId: string,
  ) => void;
}) {
  const dropRef = useRef<HTMLAnchorElement>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const Icon = folderIcons[folder.icon];
  const isActive = folder.id === currentFolderId;
  const indentStyle = {
    '--folder-rail-item-indent': folder.depth
      ? `${8 + folder.depth * 14}px`
      : '0.75rem',
  } as CSSProperties;

  useEffect(() => {
    const element = dropRef.current;

    if (!element || isActionPending) {
      return;
    }

    return dropTargetForElements({
      element,
      getData: () => ({ folderId: folder.id }),
      canDrop: ({ source }) => {
        const data = source.data;
        return isMailMessageDragData(data) && data.sourceFolderId !== folder.id;
      },
      onDragEnter: () => setIsDraggingOver(true),
      onDragLeave: () => setIsDraggingOver(false),
      onDrop: ({ source }) => {
        setIsDraggingOver(false);

        const data = source.data;

        if (!isMailMessageDragData(data) || data.sourceFolderId === folder.id) {
          return;
        }

        onMoveMessage(data.message, folder.id);
      },
    });
  }, [folder.id, isActionPending, onMoveMessage]);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          ref={dropRef}
          to="/mail/$folderId"
          params={{ folderId: encodeRouteId(folder.id) }}
          className={cn(
            'flex h-10 shrink-0 items-center gap-3 rounded-md pr-3 pl-[var(--folder-rail-item-indent)] text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground max-lg:justify-center max-lg:px-0',
            isActive && 'bg-accent text-accent-foreground',
            isDraggingOver &&
              'bg-primary/10 text-accent-foreground ring-2 ring-inset ring-primary/30',
          )}
          style={indentStyle}
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
      </TooltipTrigger>
      <TooltipContent side="right" className="lg:hidden">
        {folder.label}
      </TooltipContent>
    </Tooltip>
  );
}
