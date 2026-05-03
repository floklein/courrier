export class GraphRequestError extends Error {
  constructor({
    body,
    code,
    message,
    status,
  }: {
    body: string;
    code?: string;
    message: string;
    status: number;
  }) {
    super(`Microsoft Graph request failed: ${status} ${message}`);
    this.name = 'GraphRequestError';
    this.body = body;
    this.code = code;
    this.status = status;
  }

  readonly body: string;
  readonly code: string | undefined;
  readonly status: number;
}

export function isGraphItemNotFoundError(error: unknown) {
  if (error instanceof GraphRequestError) {
    return error.status === 404 && error.code === 'ErrorItemNotFound';
  }

  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes('Microsoft Graph request failed: 404') &&
    message.includes('ErrorItemNotFound')
  );
}

export function isMicrosoftSignInRequiredError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes('Microsoft sign-in is required.') ||
    message.includes('Google sign-in is required.') ||
    message.includes('Sign-in is required.')
  );
}
