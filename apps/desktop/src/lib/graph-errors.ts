export function isGraphItemNotFoundError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes('Microsoft Graph request failed: 404') &&
    message.includes('ErrorItemNotFound')
  );
}
