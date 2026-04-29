import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount: number, error: Error) => {
        if (
          error instanceof Error &&
          (error.message.includes('MICROSOFT_CLIENT_ID') ||
            error.message.includes('Microsoft sign-in is required'))
        ) {
          return false;
        }

        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});
