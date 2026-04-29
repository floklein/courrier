import {
  Archive,
  Clock,
  FileText,
  FolderOpen,
  Inbox,
  MailX,
  Send,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { FolderIcon } from '../mail-types';

export const folderIcons: Record<FolderIcon, LucideIcon> = {
  inbox: Inbox,
  send: Send,
  folder: FolderOpen,
  file: FileText,
  'mail-x': MailX,
  archive: Archive,
  trash: Trash2,
  star: Star,
  clock: Clock,
};
