import { Inbox } from 'lucide-react';

export function EmptyFolder() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-64 text-center">
        <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-muted">
          <Inbox className="size-5 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-sm font-semibold">No messages here</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This Outlook folder does not have any messages to show.
        </p>
      </div>
    </div>
  );
}
