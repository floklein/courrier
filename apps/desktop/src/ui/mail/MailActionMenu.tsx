import {
  Archive,
  BadgeAlert,
  Flag,
  FolderInput,
  Mail,
  MailOpen,
  Reply,
  Star,
  Trash2,
} from 'lucide-react';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import type {
  MailActionCapability,
  MailFolder,
  MailMessageSummary,
} from '@/lib/mail-types';

interface MailActionMenuProps {
  currentFolderId: string;
  actionCapabilities: MailActionCapability[];
  folders: MailFolder[];
  isBusy?: boolean;
  message: MailMessageSummary;
  onArchive: (message: MailMessageSummary) => void;
  onDelete: (message: MailMessageSummary) => void;
  onMarkJunk: (message: MailMessageSummary, isJunk: boolean) => void;
  onMarkReadState: (message: MailMessageSummary, isRead: boolean) => void;
  onMove: (message: MailMessageSummary, destinationFolderId: string) => void;
  onReply: (message: MailMessageSummary) => void;
  onToggleFlag: (message: MailMessageSummary, isFlagged: boolean) => void;
  onToggleImportant: (message: MailMessageSummary, isImportant: boolean) => void;
  onToggleStar: (message: MailMessageSummary, isStarred: boolean) => void;
}

export function MailActionDropdownContent(props: MailActionMenuProps) {
  const { MarkIcon, markLabel } = getMailActionState(props.message);

  return (
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuItem
        disabled={props.isBusy}
        onClick={() => props.onReply(props.message)}
      >
        <Reply />
        Reply
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={props.isBusy}
        onClick={() => props.onMarkReadState(props.message, !props.message.isRead)}
      >
        <MarkIcon />
        {markLabel}
      </DropdownMenuItem>
      <TriageDropdownItems {...props} />
      <DropdownMoveSubmenu {...props} />
      <DropdownMenuSeparator />
      <DropdownMenuItem
        disabled={props.isBusy}
        variant="destructive"
        onClick={() => props.onDelete(props.message)}
      >
        <Trash2 />
        Move to trash
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function MailActionContextContent(props: MailActionMenuProps) {
  const { MarkIcon, markLabel } = getMailActionState(props.message);

  return (
    <ContextMenuContent className="w-56">
      <ContextMenuItem
        disabled={props.isBusy}
        onClick={() => props.onReply(props.message)}
      >
        <Reply />
        Reply
      </ContextMenuItem>
      <ContextMenuItem
        disabled={props.isBusy}
        onClick={() => props.onMarkReadState(props.message, !props.message.isRead)}
      >
        <MarkIcon />
        {markLabel}
      </ContextMenuItem>
      <TriageContextItems {...props} />
      <ContextMoveSubmenu {...props} />
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={props.isBusy}
        variant="destructive"
        onClick={() => props.onDelete(props.message)}
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
            onClick={() => props.onMove(props.message, folder.id)}
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
            onClick={() => props.onMove(props.message, folder.id)}
          >
            <span className="truncate">{folder.label}</span>
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function TriageDropdownItems(props: MailActionMenuProps) {
  const junkState = getJunkActionState(props.folders, props.currentFolderId);

  return (
    <>
      {can(props, 'archive') &&
        !isArchiveFolder(props.folders, props.currentFolderId) && (
          <DropdownMenuItem
            disabled={props.isBusy}
            onClick={() => props.onArchive(props.message)}
          >
            <Archive />
            Archive
          </DropdownMenuItem>
        )}
      {can(props, 'star') && (
        <DropdownMenuItem
          disabled={props.isBusy}
          onClick={() =>
            props.onToggleStar(props.message, !props.message.isStarred)
          }
        >
          <Star />
          {props.message.isStarred ? 'Unstar' : 'Star'}
        </DropdownMenuItem>
      )}
      {can(props, 'flag') && (
        <DropdownMenuItem
          disabled={props.isBusy}
          onClick={() =>
            props.onToggleFlag(props.message, !props.message.isFlagged)
          }
        >
          <Flag />
          {props.message.isFlagged ? 'Clear flag' : 'Flag'}
        </DropdownMenuItem>
      )}
      {can(props, 'important') && (
        <DropdownMenuItem
          disabled={props.isBusy}
          onClick={() =>
            props.onToggleImportant(props.message, !props.message.isImportant)
          }
        >
          <BadgeAlert />
          {props.message.isImportant ? 'Mark normal' : 'Mark important'}
        </DropdownMenuItem>
      )}
      {can(props, 'junk') && (
        <DropdownMenuItem
          disabled={props.isBusy}
          onClick={() => props.onMarkJunk(props.message, junkState.isJunk)}
        >
          <BadgeAlert />
          {junkState.label}
        </DropdownMenuItem>
      )}
    </>
  );
}

function TriageContextItems(props: MailActionMenuProps) {
  const junkState = getJunkActionState(props.folders, props.currentFolderId);

  return (
    <>
      {can(props, 'archive') &&
        !isArchiveFolder(props.folders, props.currentFolderId) && (
          <ContextMenuItem
            disabled={props.isBusy}
            onClick={() => props.onArchive(props.message)}
          >
            <Archive />
            Archive
          </ContextMenuItem>
        )}
      {can(props, 'star') && (
        <ContextMenuItem
          disabled={props.isBusy}
          onClick={() =>
            props.onToggleStar(props.message, !props.message.isStarred)
          }
        >
          <Star />
          {props.message.isStarred ? 'Unstar' : 'Star'}
        </ContextMenuItem>
      )}
      {can(props, 'flag') && (
        <ContextMenuItem
          disabled={props.isBusy}
          onClick={() =>
            props.onToggleFlag(props.message, !props.message.isFlagged)
          }
        >
          <Flag />
          {props.message.isFlagged ? 'Clear flag' : 'Flag'}
        </ContextMenuItem>
      )}
      {can(props, 'important') && (
        <ContextMenuItem
          disabled={props.isBusy}
          onClick={() =>
            props.onToggleImportant(props.message, !props.message.isImportant)
          }
        >
          <BadgeAlert />
          {props.message.isImportant ? 'Mark normal' : 'Mark important'}
        </ContextMenuItem>
      )}
      {can(props, 'junk') && (
        <ContextMenuItem
          disabled={props.isBusy}
          onClick={() => props.onMarkJunk(props.message, junkState.isJunk)}
        >
          <BadgeAlert />
          {junkState.label}
        </ContextMenuItem>
      )}
    </>
  );
}

function getDestinationFolders(folders: MailFolder[], currentFolderId: string) {
  return folders.filter((folder) => folder.id !== currentFolderId);
}

function can(props: MailActionMenuProps, capability: MailActionCapability) {
  return props.actionCapabilities.includes(capability);
}

export function getJunkActionState(
  folders: MailFolder[],
  currentFolderId: string,
) {
  const isJunk = isJunkFolder(folders, currentFolderId);

  return {
    isJunk: !isJunk,
    label: isJunk ? 'Not junk' : 'Mark as junk',
  };
}

export function isArchiveFolder(
  folders: MailFolder[],
  currentFolderId: string,
) {
  const folder = folders.find((candidate) => candidate.id === currentFolderId);

  return folder?.wellKnownName === 'archive' || currentFolderId === 'archive';
}

function isJunkFolder(folders: MailFolder[], currentFolderId: string) {
  const folder = folders.find((candidate) => candidate.id === currentFolderId);

  return (
    folder?.wellKnownName === 'junkemail' ||
    currentFolderId === 'junkemail' ||
    currentFolderId === 'SPAM'
  );
}

function getMailActionState(message: MailMessageSummary) {
  return {
    MarkIcon: message.isRead ? Mail : MailOpen,
    markLabel: message.isRead ? 'Mark as unread' : 'Mark as read',
  };
}
