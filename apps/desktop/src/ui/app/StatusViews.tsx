import { Loader2 } from 'lucide-react';

export function FullScreenStatus({ label }: { label: string }) {
  return (
    <main className="flex h-full items-center justify-center bg-background p-8">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {label}
      </div>
    </main>
  );
}

export function PanelStatus({ label }: { label: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

export function RailStatus({ label }: { label: string }) {
  return (
    <div className="flex h-10 items-center gap-2 rounded-md px-3 text-xs text-muted-foreground max-lg:justify-center max-lg:px-0">
      <Loader2 className="size-3.5 animate-spin" />
      <span className="max-lg:hidden">{label}</span>
    </div>
  );
}
