import {
  Archive,
  Clock,
  FileText,
  Inbox,
  Send,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { FolderIcon } from '../lib/mail-types';

export const folderIcons: Record<FolderIcon, LucideIcon> = {
  inbox: Inbox,
  send: Send,
  file: FileText,
  archive: Archive,
  trash: Trash2,
  star: Star,
  clock: Clock,
};
