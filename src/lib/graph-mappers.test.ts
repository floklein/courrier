import { describe, expect, it } from 'vitest';
import {
  mapGraphFolder,
  mapGraphMessageDetail,
  mapGraphMessageSummary,
  sortMailFolders,
} from './graph-mappers';

describe('graph mail mappers', () => {
  it('orders well-known folders before custom folders and keeps unread counts', () => {
    const folders = sortMailFolders([
      mapGraphFolder({
        id: 'project',
        displayName: 'Project',
        unreadItemCount: 2,
        totalItemCount: 10,
        childFolderCount: 0,
      }),
      mapGraphFolder({
        id: 'inbox',
        displayName: 'Inbox',
        wellKnownName: 'inbox',
        unreadItemCount: 7,
        totalItemCount: 20,
        childFolderCount: 1,
      }),
      mapGraphFolder({
        id: 'sent',
        displayName: 'Sent Items',
        wellKnownName: 'sentitems',
        unreadItemCount: 0,
        totalItemCount: 5,
        childFolderCount: 0,
      }),
    ]);

    expect(folders.map((folder) => folder.id)).toEqual([
      'inbox',
      'sent',
      'project',
    ]);
    expect(folders[0]).toMatchObject({
      label: 'Inbox',
      unreadCount: 7,
      totalCount: 20,
      icon: 'inbox',
      hasChildren: true,
    });
  });

  it('maps a Graph message summary into renderer mail fields', () => {
    const message = mapGraphMessageSummary('inbox', {
      id: 'message-1',
      subject: 'Roadmap',
      bodyPreview: 'Here is the plan',
      receivedDateTime: '2026-04-27T07:45:00Z',
      isRead: false,
      hasAttachments: true,
      importance: 'high',
      from: {
        emailAddress: {
          name: 'Mina Chen',
          address: 'mina@example.com',
        },
      },
      toRecipients: [
        {
          emailAddress: {
            name: 'Florent Klein',
            address: 'florent@example.com',
          },
        },
      ],
    });

    expect(message).toMatchObject({
      id: 'message-1',
      folderId: 'inbox',
      sender: {
        name: 'Mina Chen',
        email: 'mina@example.com',
      },
      recipients: ['Florent Klein <florent@example.com>'],
      subject: 'Roadmap',
      preview: 'Here is the plan',
      isRead: false,
      hasAttachments: true,
      importance: 'high',
    });
  });

  it('maps detail bodies without trusting missing optional Graph fields', () => {
    const message = mapGraphMessageDetail('archive', {
      id: 'message-2',
      subject: null,
      bodyPreview: null,
      receivedDateTime: null,
      isRead: true,
      from: null,
      toRecipients: [],
      body: {
        contentType: 'html',
        content: '<p>Hello</p>',
      },
    });

    expect(message).toMatchObject({
      id: 'message-2',
      folderId: 'archive',
      sender: {
        name: 'Unknown sender',
        email: '',
      },
      subject: '(No subject)',
      preview: '',
      receivedDateTime: '',
      bodyContentType: 'html',
      bodyContent: '<p>Hello</p>',
    });
  });
});
