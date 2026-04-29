import type { MailMessageSummary } from '../../lib/mail-types';
import { cn } from '../../lib/utils';

export function MailDragPreview({
  className,
  message,
}: {
  className?: string;
  message: MailMessageSummary;
}) {
  return (
    <div
      className={cn(
        'max-w-64 overflow-hidden rounded-md border bg-popover px-3 py-2 text-popover-foreground shadow-md',
        className,
      )}
    >
      <p className="truncate text-xs font-medium">{message.sender.name}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {message.subject}
      </p>
    </div>
  );
}
