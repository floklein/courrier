import {
  Check,
  ChevronsUpDown,
  Loader2,
  LogOut,
  MailPlus,
  Monitor,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { getInitials } from '../../lib/mail/mail-utils';
import { api } from '../../lib/api-client';
import type { MailAccount, ProviderId } from '../../lib/mail-types';
import { useTheme } from '../../theme/ThemeProvider';

export function UserMenu({
  accounts,
  activeAccountId,
  accountEmail,
  accountName,
  isSigningOut,
  onSignOut,
}: {
  accounts: MailAccount[];
  activeAccountId: string;
  accountEmail: string;
  accountName: string;
  isSigningOut: boolean;
  onSignOut: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const switchAccountMutation = useMutation({
    mutationFn: (accountId: string) => api.auth.switchAccount(accountId),
    onSuccess: async (session) => {
      queryClient.setQueryData(['auth', 'session'], session);
      await queryClient.invalidateQueries({ queryKey: ['mail'] });
    },
  });
  const signInMutation = useMutation({
    mutationFn: (providerId: ProviderId) => api.auth.signIn(providerId),
    onSuccess: async (session) => {
      queryClient.setQueryData(['auth', 'session'], session);
      await queryClient.invalidateQueries({ queryKey: ['mail'] });
    },
  });

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
              <Avatar className="size-8">
                <AvatarFallback>{getInitials(accountName)}</AvatarFallback>
              </Avatar>
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
            <Avatar className="size-9">
              <AvatarFallback>{getInitials(accountName)}</AvatarFallback>
            </Avatar>
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
                  <Avatar className="size-5">
                    <AvatarFallback className="text-[10px]">
                      {getInitials(account.name ?? account.email)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate">
                    {account.email}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuItem
              disabled={signInMutation.isPending}
              onClick={() => signInMutation.mutate('microsoft')}
              className="mx-1 px-3 py-2"
            >
              <MailPlus data-icon="inline-start" />
              Add Microsoft account
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={signInMutation.isPending}
              onClick={() => signInMutation.mutate('google')}
              className="mx-1 px-3 py-2"
            >
              <MailPlus data-icon="inline-start" />
              Add Google account
            </DropdownMenuItem>
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
