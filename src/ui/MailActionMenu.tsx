import {
  FolderInput,
  Mail,
  MailOpen,
  Reply,
  Trash2,
} from 'lucide-react';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '../components/ui/context-menu';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../components/ui/dropdown-menu';
import type { MailFolder, MailMessageSummary } from '../lib/mail-types';

interface MailActionMenuProps {
  currentFolderId: string;
  folders: MailFolder[];
  isBusy?: boolean;
  message: MailMessageSummary;
  onDelete: (message: MailMessageSummary) => void;
  onMarkReadState: (message: MailMessageSummary, isRead: boolean) => void;
  onMove: (message: MailMessageSummary, destinationFolderId: string) => void;
  onReply: (message: MailMessageSummary) => void;
}

export function MailActionDropdownContent(props: MailActionMenuProps) {
  const markLabel = props.message.isRead ? 'Mark as unread' : 'Mark as read';
  const MarkIcon = props.message.isRead ? Mail : MailOpen;

  return (
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuItem
        disabled={props.isBusy}
        onSelect={() => props.onReply(props.message)}
      >
        <Reply />
        Reply
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={props.isBusy}
        onSelect={() => props.onMarkReadState(props.message, !props.message.isRead)}
      >
        <MarkIcon />
        {markLabel}
      </DropdownMenuItem>
      <DropdownMoveSubmenu {...props} />
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={props.isBusy}
        variant="destructive"
        onSelect={() => props.onDelete(props.message)}
      >
        <Trash2 />
        Move to trash
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function MailActionContextContent(props: MailActionMenuProps) {
  const markLabel = props.message.isRead ? 'Mark as unread' : 'Mark as read';
  const MarkIcon = props.message.isRead ? Mail : MailOpen;

  return (
    <ContextMenuContent className="w-56">
      <ContextMenuItem
        disabled={props.isBusy}
        onSelect={() => props.onReply(props.message)}
      >
        <Reply />
        Reply
      </ContextMenuItem>
      <ContextMenuItem
        disabled={props.isBusy}
        onSelect={() => props.onMarkReadState(props.message, !props.message.isRead)}
      >
        <MarkIcon />
        {markLabel}
      </ContextMenuItem>
      <ContextMoveSubmenu {...props} />
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={props.isBusy}
        variant="destructive"
        onSelect={() => props.onDelete(props.message)}
      >
        <Trash2 />
        Move to trash
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function DropdownMoveSubmenu(props: MailActionMenuProps) {
  const destinationFolders = getDestinationFolders(
    props.folders,
    props.currentFolderId,
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={props.isBusy}>
        <FolderInput />
        Move to
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 w-56 overflow-y-auto">
        {destinationFolders.map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            onSelect={() => props.onMove(props.message, folder.id)}
          >
            <span className="truncate">{folder.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ContextMoveSubmenu(props: MailActionMenuProps) {
  const destinationFolders = getDestinationFolders(
    props.folders,
    props.currentFolderId,
  );

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={props.isBusy}>
        <FolderInput />
        Move to
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="max-h-72 w-56 overflow-y-auto">
        {destinationFolders.map((folder) => (
          <ContextMenuItem
            key={folder.id}
            onSelect={() => props.onMove(props.message, folder.id)}
          >
            <span className="truncate">{folder.label}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function getDestinationFolders(folders: MailFolder[], currentFolderId: string) {
  return folders.filter((folder) => folder.id !== currentFolderId);
}
