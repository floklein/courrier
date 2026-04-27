import { Link } from '@tanstack/react-router';
import { Paperclip } from 'lucide-react';
import { Avatar, AvatarFallback } from '../components/ui/avatar';
import type { MailMessageSummary } from '../lib/mail-types';
import { encodeRouteId } from '../lib/route-ids';
import { cn } from '../lib/utils';
import { formatMailDate, getInitials } from './mail-utils';

export function MessageListItem({
  folderId,
  isSelected,
  message,
}: {
  folderId: string;
  isSelected: boolean;
  message: MailMessageSummary;
}) {
  return (
    <Link
      to="/mail/$folderId/$messageId"
      params={{
        folderId: encodeRouteId(folderId),
        messageId: encodeRouteId(message.id),
      }}
      className={cn(
        'group block min-w-0 overflow-hidden border-b px-3 py-3 transition-colors hover:bg-accent/70',
        isSelected && 'bg-accent',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <Avatar className="size-9">
          <AvatarFallback>{getInitials(message.sender.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p
              className={cn(
                'min-w-0 truncate text-sm',
                !message.isRead && 'font-semibold',
              )}
            >
              {message.sender.name}
            </p>
            {message.hasAttachments && (
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
              {formatMailDate(message.receivedDateTime, 'short')}
            </span>
          </div>
          <p
            className={cn(
              'mt-1 truncate text-sm text-foreground',
              !message.isRead && 'font-medium',
            )}
          >
            {message.subject}
          </p>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
            {message.preview}
          </p>
        </div>
      </div>
    </Link>
  );
}
