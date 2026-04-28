import type { MailMessageSummary } from '../mail-types';

export const mailMessageDragType = 'courrier-mail-message';

export interface MailMessageDragData {
  type: typeof mailMessageDragType;
  message: MailMessageSummary;
  sourceFolderId: string;
}

export function isMailMessageDragData(
  data: unknown,
): data is MailMessageDragData {
  if (typeof data !== 'object' || data === null) {
    return false;
  }

  const candidate = data as Record<string, unknown>;

  return (
    candidate.type === mailMessageDragType &&
    typeof candidate.sourceFolderId === 'string' &&
    typeof candidate.message === 'object' &&
    candidate.message !== null
  );
}
