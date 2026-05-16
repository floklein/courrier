import {
  Check,
  ChevronsUpDown,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useMutation, useQueries } from '@tanstack/react-query';
import { useCallback } from 'react';
import GoogleIcon from '@/assets/providers/google.svg?react';
import MicrosoftIcon from '@/assets/providers/microsoft.svg?react';
import { Avatar, AvatarBadge } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveMailAccountChange } from '@/hooks/useActiveMailAccountChange';
import { api } from '@/lib/api-client';
import { mailFoldersQueryOptions } from '@/lib/mail/mail-query-options';
import type {
  AuthSession,
  MailAccount,
  MailFolder,
  ProviderConfigurationStatus,
  ProviderId,
} from '@/lib/mail-types';
import { useTheme } from '@/theme/ThemeProvider';

export function UserMenu({
  accounts,
  providers,
  activeAccountId,
  accountEmail,
  accountName,
  isSigningOut,
  onSignOut,
}: {
  accounts: MailAccount[];
  providers: ProviderConfigurationStatus[];
  activeAccountId: string;
  accountEmail: string;
  accountName: string;
  isSigningOut: boolean;
  onSignOut: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const {
    applyActiveMailAccountSession,
    prepareActiveMailAccountChange,
  } = useActiveMailAccountChange();
  const handleAccountSessionChange = useCallback(
    async (session: AuthSession) => {
      await prepareActiveMailAccountChange();
      await applyActiveMailAccountSession(session);
    },
    [applyActiveMailAccountSession, prepareActiveMailAccountChange],
  );
  const switchAccountMutation = useMutation({
    mutationFn: async (accountId: string) => {
      await prepareActiveMailAccountChange();
      return api.auth.switchAccount(accountId);
    },
    onSuccess: async (session) => {
      await applyActiveMailAccountSession(session);
    },
  });
  const signInMutation = useMutation({
    mutationFn: (providerId: ProviderId) => api.auth.signIn(providerId),
    onSuccess: handleAccountSessionChange,
  });
  const microsoftProvider = getProviderStatus(providers, 'microsoft');
  const googleProvider = getProviderStatus(providers, 'google');
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
  const accountFolderQueries = useQueries({
    queries: accounts.map((account) => mailFoldersQueryOptions(account.id)),
  });
  const unreadInboxCountsByAccountId = new Map(
    accounts.map((account, index) => [
      account.id,
      getUnreadInboxCount(accountFolderQueries[index]?.data as MailFolder[] | undefined),
    ]),
  );
  const signingInProviderId = signInMutation.isPending
    ? signInMutation.variables
    : undefined;

  return (
    <div className="w-full">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              className="h-12 w-full justify-start gap-2 px-2 max-lg:h-12 max-lg:justify-center max-lg:px-0"
              aria-label="User menu"
            >
              <ProviderIcon
                providerId={activeAccount?.providerId}
                className="size-8"
              />
              <span className="flex min-w-0 flex-1 flex-col items-start max-lg:hidden">
                <span className="truncate text-sm font-semibold leading-5">
                  {accountName}
                </span>
                <span className="truncate text-xs font-normal leading-4 text-muted-foreground">
                  {accountEmail}
                </span>
              </span>
              <ChevronsUpDown
                className="ml-auto max-lg:hidden"
              />
            </Button>
          }
        />
        <DropdownMenuContent side="right" align="end" className="w-72 p-0">
          <div className="flex items-center gap-3 p-3">
            <ProviderIcon
              providerId={activeAccount?.providerId}
              className="size-9"
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold">
                {accountName}
              </span>
              <span className="truncate text-xs font-normal text-muted-foreground">
                {accountEmail}
              </span>
            </span>
          </div>
          <DropdownMenuSeparator className="m-0" />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-3 py-2 text-xs font-normal text-muted-foreground">
              Accounts
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={activeAccountId}
              disabled={switchAccountMutation.isPending}
              onValueChange={(accountId) => {
                if (accountId === activeAccountId) {
                  return;
                }

                switchAccountMutation.mutate(accountId);
              }}
            >
              {accounts.map((account) => (
                <DropdownMenuRadioItem
                  key={account.id}
                  value={account.id}
                  closeOnClick
                  label={account.email}
                  className="mx-1 px-3 py-2"
                >
                  <AccountProviderIcon
                    providerId={account.providerId}
                    unreadCount={unreadInboxCountsByAccountId.get(account.id)}
                    className="size-5"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {account.email}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                disabled={signInMutation.isPending}
                className="mx-1 px-3 py-2"
              >
                <Plus data-icon="inline-start" />
                Add account
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56 p-1">
                <DropdownMenuItem
                  closeOnClick={false}
                  disabled={
                    signInMutation.isPending ||
                    !microsoftProvider?.isConfigured
                  }
                  title={microsoftProvider?.message}
                  onClick={() => signInMutation.mutate('microsoft')}
                  className="px-2 py-2"
                >
                  {signingInProviderId === 'microsoft' ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <ProviderIcon providerId="microsoft" />
                  )}
                  Add Microsoft account
                </DropdownMenuItem>
                <DropdownMenuItem
                  closeOnClick={false}
                  disabled={
                    signInMutation.isPending || !googleProvider?.isConfigured
                  }
                  title={googleProvider?.message}
                  onClick={() => signInMutation.mutate('google')}
                  className="px-2 py-2"
                >
                  {signingInProviderId === 'google' ? (
                    <Loader2 data-icon="inline-start" className="animate-spin" />
                  ) : (
                    <ProviderIcon providerId="google" />
                  )}
                  Add Google account
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {signInMutation.error && (
              <div className="mx-1 mt-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-5 text-destructive">
                {signInMutation.error.message}
              </div>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
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
              onClick={onSignOut}
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
    </div>
  );
}

function getProviderStatus(
  providers: ProviderConfigurationStatus[],
  providerId: ProviderId,
) {
  return providers.find((provider) => provider.providerId === providerId);
}

function getUnreadInboxCount(folders: MailFolder[] | undefined) {
  if (!folders) {
    return undefined;
  }

  return (
    folders.find((folder) => folder.wellKnownName === 'inbox') ??
    folders.find((folder) => folder.id.toLowerCase() === 'inbox') ??
    folders[0]
  )?.unreadCount;
}

function ThemeMenuItem({
  icon: Icon,
  isSelected,
  label,
  onSelect,
}: {
  icon: LucideIcon;
  isSelected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem onClick={onSelect} className="mx-1 px-3 py-2">
      <Icon data-icon="inline-start" />
      {label}
      {isSelected && <Check data-icon="inline-end" className="ml-auto" />}
    </DropdownMenuItem>
  );
}

function ProviderIcon({
  providerId,
  className = 'size-4',
}: {
  providerId: ProviderId | undefined;
  className?: string;
}) {
  const Icon = providerId === 'google' ? GoogleIcon : MicrosoftIcon;

  return (
    <Icon
      aria-hidden="true"
      data-icon="inline-start"
      className={`${className} shrink-0 text-current`}
    />
  );
}

function AccountProviderIcon({
  providerId,
  unreadCount,
  className = 'size-4',
}: {
  providerId: ProviderId | undefined;
  unreadCount: number | undefined;
  className?: string;
}) {
  const hasUnread = Boolean(unreadCount && unreadCount > 0);

  return (
    <Avatar
      size="sm"
      className={`${className} bg-transparent text-current after:hidden`}
      aria-label={hasUnread ? `${unreadCount} unread in inbox` : undefined}
    >
      <ProviderIcon providerId={providerId} className="size-full" />
      {hasUnread && (
        <AvatarBadge className="bg-destructive text-destructive-foreground" />
      )}
    </Avatar>
  );
}
