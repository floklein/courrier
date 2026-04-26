export type FolderIcon =
  | 'inbox'
  | 'send'
  | 'file'
  | 'archive'
  | 'trash'
  | 'star'
  | 'clock';

export interface MailFolder {
  id: string;
  label: string;
  icon: FolderIcon;
  unreadCount: number;
}

export interface MailMessage {
  id: string;
  folderId: string;
  sender: {
    name: string;
    email: string;
  };
  recipients: string[];
  subject: string;
  preview: string;
  body: string[];
  date: string;
  read: boolean;
  starred: boolean;
}

export const mailFolders: MailFolder[] = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox', unreadCount: 4 },
  { id: 'sent', label: 'Sent', icon: 'send', unreadCount: 0 },
  { id: 'drafts', label: 'Drafts', icon: 'file', unreadCount: 1 },
  { id: 'starred', label: 'Starred', icon: 'star', unreadCount: 0 },
  { id: 'archive', label: 'Archive', icon: 'archive', unreadCount: 0 },
  { id: 'trash', label: 'Trash', icon: 'trash', unreadCount: 0 },
];

export const mailMessages: MailMessage[] = [
  {
    id: 'weekly-product-notes',
    folderId: 'inbox',
    sender: { name: 'Mina Chen', email: 'mina@northstar.studio' },
    recipients: ['florent@courrier.local'],
    subject: 'Weekly product notes',
    preview: 'A quiet inbox pass, the router sketch, and a few UI polish notes.',
    body: [
      'I pulled together the product notes from this week. The main thread is still the same: keep the inbox calm, fast to scan, and opinionated about what deserves attention.',
      'The first version only needs the essential flow. Folder navigation, a readable message list, and a generous reading pane will tell us enough before we add write actions.',
      'I also left a few examples of denser content so the layout can prove it holds up when a real mailbox is connected later.',
    ],
    date: 'Apr 26, 2026',
    read: false,
    starred: true,
  },
  {
    id: 'design-review-window',
    folderId: 'inbox',
    sender: { name: 'Armand Silva', email: 'armand@atelier.dev' },
    recipients: ['florent@courrier.local'],
    subject: 'Design review window',
    preview: 'Could we keep the first pass light and avoid a heavy command center?',
    body: [
      'For the design review, I would keep the interface closer to a composed desktop tool than a dashboard. The content should feel organized without asking the user to learn a new system.',
      'A narrow folder rail, a balanced message list, and a proper reading surface should be enough. The toolbar can exist, but the page should still feel like reading is the primary action.',
    ],
    date: 'Apr 25, 2026',
    read: false,
    starred: false,
  },
  {
    id: 'invoice-thread-follow-up',
    folderId: 'inbox',
    sender: { name: 'Lena Ortiz', email: 'lena@papertrail.co' },
    recipients: ['florent@courrier.local'],
    subject: 'Invoice thread follow-up',
    preview: 'The documents are ready. I added one note on the billing contact.',
    body: [
      'The documents are ready for review. I added the updated billing contact and kept the original terms attached to the thread for reference.',
      'No action is needed today unless you want the final invoice labels changed before export.',
    ],
    date: 'Apr 25, 2026',
    read: true,
    starred: false,
  },
  {
    id: 'launch-checklist',
    folderId: 'inbox',
    sender: { name: 'Nora Patel', email: 'nora@signalworks.io' },
    recipients: ['florent@courrier.local'],
    subject: 'Launch checklist',
    preview: 'Routing, fake data, and the empty states are the only blockers left.',
    body: [
      'I reviewed the launch checklist and trimmed it to the pieces that affect the first demo. Routing should be resilient, fake data should feel believable, and empty states should look intentional.',
      'Everything else can wait until there is a real mail provider behind the app.',
    ],
    date: 'Apr 24, 2026',
    read: false,
    starred: true,
  },
  {
    id: 'sent-router-summary',
    folderId: 'sent',
    sender: { name: 'Florent Klein', email: 'florent@courrier.local' },
    recipients: ['mina@northstar.studio'],
    subject: 'Router summary',
    preview: 'The Electron renderer will use hash routes for packaged builds.',
    body: [
      'I am going to use hash routing for the first Electron build so deep links survive packaged file loading without additional main-process route handling.',
      'The app can still keep clean internal route names, and we can revisit browser history routing later if the shell starts serving content differently.',
    ],
    date: 'Apr 24, 2026',
    read: true,
    starred: false,
  },
  {
    id: 'sent-ui-principles',
    folderId: 'sent',
    sender: { name: 'Florent Klein', email: 'florent@courrier.local' },
    recipients: ['armand@atelier.dev'],
    subject: 'UI principles',
    preview: 'Beautiful simplicity means restraint, hierarchy, and no ornamental noise.',
    body: [
      'For this pass, beautiful simplicity means a restrained surface, crisp interaction states, and enough density to feel useful without becoming a monitoring dashboard.',
      'I will keep the action affordances visible but non-mutating until the fake data model grows into a real mailbox model.',
    ],
    date: 'Apr 23, 2026',
    read: true,
    starred: false,
  },
  {
    id: 'draft-provider-notes',
    folderId: 'drafts',
    sender: { name: 'Florent Klein', email: 'florent@courrier.local' },
    recipients: ['team@courrier.local'],
    subject: 'Provider notes',
    preview: 'Later: decide whether IMAP, Gmail API, or another provider comes first.',
    body: [
      'Later we should decide which mail provider abstraction comes first. For now the UI should avoid leaking assumptions about labels, threads, provider-specific IDs, or sync state.',
    ],
    date: 'Apr 22, 2026',
    read: false,
    starred: false,
  },
  {
    id: 'archive-retro',
    folderId: 'archive',
    sender: { name: 'Elise Martin', email: 'elise@smallbatch.app' },
    recipients: ['florent@courrier.local'],
    subject: 'Retro notes',
    preview: 'A short archive sample to keep the folder state from feeling empty.',
    body: [
      'The retro notes are archived here for reference. The useful part was the reminder that fast navigation matters more than adding more visible controls.',
    ],
    date: 'Apr 18, 2026',
    read: true,
    starred: false,
  },
];

export function getFolder(folderId: string) {
  return mailFolders.find((folder) => folder.id === folderId);
}

export function getMessagesForFolder(folderId: string) {
  if (folderId === 'starred') {
    return mailMessages.filter((message) => message.starred);
  }

  return mailMessages.filter((message) => message.folderId === folderId);
}

export function getMessage(folderId: string, messageId: string | undefined) {
  if (!messageId) {
    return undefined;
  }

  return getMessagesForFolder(folderId).find(
    (message) => message.id === messageId,
  );
}
