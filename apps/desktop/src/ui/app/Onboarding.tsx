import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import AppIcon from '@/assets/icon.svg?react';
import GoogleIcon from '@/assets/providers/google.svg?react';
import MicrosoftIcon from '@/assets/providers/microsoft.svg?react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api-client';
import type { AuthSession, ProviderId } from '@/lib/mail-types';

export function Onboarding({
  session,
}: {
  session: Exclude<AuthSession, { status: 'authenticated' }>;
}) {
  const queryClient = useQueryClient();
  const signInMutation = useMutation({
    mutationFn: (providerId: ProviderId) => api.auth.signIn(providerId),
    onSuccess: async (session) => {
      queryClient.setQueryData(['auth', 'session'], session);
      await queryClient.invalidateQueries({ queryKey: ['mail'] });
    },
  });
  const isConfigError = session.status === 'configuration-error';
  const signingInProviderId = signInMutation.isPending
    ? signInMutation.variables
    : undefined;

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="app-window-header app-window-controls-start app-window-controls-end flex h-16 shrink-0 items-center border-b px-6">
        <div className="flex min-w-0 items-center gap-2">
          <AppIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-foreground"
          />
          <span className="text-sm font-semibold tracking-tight">Courrier</span>
          </div>
        </header>
      <main className="flex min-h-0 flex-1 items-center justify-center p-6">
        <section className="w-full max-w-md">
          <div className="flex size-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <AppIcon className="size-5" aria-hidden="true" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold tracking-tight">
            Welcome to Courrier
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Courrier needs access to a mail provider before it can show your
            folders and messages. Sign in opens the provider in your system
            browser.
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
          <div className="mt-6 flex flex-col gap-2">
            {session.providers.map((provider) => (
              <Button
                key={provider.providerId}
                className="w-full border-border bg-background text-foreground shadow-xs hover:bg-muted"
                variant="outline"
                disabled={signInMutation.isPending || !provider.isConfigured}
                onClick={() => signInMutation.mutate(provider.providerId)}
              >
                {signingInProviderId === provider.providerId ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ProviderIcon providerId={provider.providerId} />
                )}
                Sign in with {provider.displayName}
              </Button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function ProviderIcon({ providerId }: { providerId: ProviderId }) {
  const Icon = providerId === 'google' ? GoogleIcon : MicrosoftIcon;

  return (
    <Icon
      aria-hidden="true"
      data-icon="inline-start"
      className="size-4 text-current"
    />
  );
}
