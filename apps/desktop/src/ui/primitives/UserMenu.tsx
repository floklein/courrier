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
import { useMutation } from '@tanstack/react-query';
import type { CSSProperties } from 'react';
import googleIconUrl from '../../assets/providers/google.svg';
import microsoftIconUrl from '../../assets/providers/microsoft.svg';
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { useActiveMailAccountChange } from '../../hooks/useActiveMailAccountChange';
import { api } from '../../lib/api-client';
import type {
  MailAccount,
  ProviderConfigurationStatus,
  ProviderId,
} from '../../lib/mail-types';
import { useTheme } from '../../theme/ThemeProvider';

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
    invalidateMailState,
    prepareActiveMailAccountChange,
  } = useActiveMailAccountChange();
  const switchAccountMutation = useMutation({
    mutationFn: (accountId: string) => api.auth.switchAccount(accountId),
    onMutate: prepareActiveMailAccountChange,
    onSuccess: async (session) => {
      applyActiveMailAccountSession(session);
      await invalidateMailState();
    },
  });
  const signInMutation = useMutation({
    mutationFn: (providerId: ProviderId) => api.auth.signIn(providerId),
    onSuccess: async (session) => {
      applyActiveMailAccountSession(session);
      await invalidateMailState();
    },
  });
  const microsoftProvider = getProviderStatus(providers, 'microsoft');
  const googleProvider = getProviderStatus(providers, 'google');
  const activeAccount = accounts.find((account) => account.id === activeAccountId);
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
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <ProviderIcon
                      providerId={account.providerId}
                      className="size-5"
                    />
                  </span>
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
                <MailPlus data-icon="inline-start" />
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
                  Microsoft account
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
                  Google account
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
  const src = providerId === 'google' ? googleIconUrl : microsoftIconUrl;
  const maskStyle = {
    '--provider-icon-url': `url("${src}")`,
  } as CSSProperties;

  return (
    <span
      aria-hidden="true"
      data-icon="inline-start"
      className={`${className} inline-block shrink-0 bg-current [mask:var(--provider-icon-url)_center/contain_no-repeat]`}
      style={maskStyle}
    />
  );
}
