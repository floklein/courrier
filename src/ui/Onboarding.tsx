import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail } from 'lucide-react';
import { Button } from '../components/ui/button';
import { api } from '../lib/api-client';
import type { AuthSession } from '../lib/mail-types';

export function Onboarding({
  session,
}: {
  session: Exclude<AuthSession, { status: 'authenticated' }>;
}) {
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
          Welcome to Courrier
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
          {signInMutation.isPending && (
            <Loader2 className="size-4 animate-spin" />
          )}
          Sign in with Microsoft
        </Button>
      </section>
    </main>
  );
}
