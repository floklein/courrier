import type { MailMessageSummary } from '@/lib/mail-types';

export const mailMessageDragType = 'courrier-mail-message';

export interface MailMessageDragData {
  type: typeof mailMessageDragType;
  message: MailMessageSummary;
  messages?: MailMessageSummary[];
  sourceFolderId: string;
  primaryMessageId?: string;
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
    candidate.message !== null &&
    (
      candidate.messages === undefined ||
      Array.isArray(candidate.messages)
    )
  );
}

export function getMovableMailMessages(
  data: Pick<
    MailMessageDragData,
    'message' | 'messages' | 'sourceFolderId'
  >,
  destinationFolderId: string,
) {
  return (data.messages ?? [data.message]).filter(
    (message) =>
      (message.folderId || data.sourceFolderId) !== destinationFolderId,
  );
}
