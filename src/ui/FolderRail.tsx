import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Mail } from 'lucide-react';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { api } from '../lib/api-client';
import type { MailFolder } from '../lib/mail-types';
import { encodeRouteId } from '../lib/route-ids';
import { cn } from '../lib/utils';
import { folderIcons } from './mail-icons';
import { RailStatus } from './StatusViews';
import { UserMenu } from './UserMenu';

export function FolderRail({
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
      <div className="flex h-16 items-center gap-2 px-3 max-lg:justify-center max-lg:px-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
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
                style={{
                  paddingLeft: folder.depth
                    ? 8 + folder.depth * 14
                    : undefined,
                }}
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
