export const api = {
  auth: {
    getSession: () => window.courrier.auth.getSession(),
    signIn: () => window.courrier.auth.signIn(),
    signOut: () => window.courrier.auth.signOut(),
  },
  mail: {
    listFolders: () => window.courrier.mail.listFolders(),
    listMessages: (folderId: string, pageUrl?: string, searchQuery?: string) =>
      window.courrier.mail.listMessages(folderId, pageUrl, searchQuery),
    getMessage: (folderId: string, messageId: string) =>
      window.courrier.mail.getMessage(folderId, messageId),
    markMessageReadState: (messageId: string, isRead: boolean) =>
      window.courrier.mail.markMessageReadState(messageId, isRead),
    moveMessage: (messageId: string, destinationFolderId: string) =>
      window.courrier.mail.moveMessage(messageId, destinationFolderId),
    deleteMessage: (messageId: string) =>
      window.courrier.mail.deleteMessage(messageId),
    sendMessage: window.courrier.mail.sendMessage,
    replyToMessage: window.courrier.mail.replyToMessage,
    onRemoteChange: window.courrier.mail.onRemoteChange,
  },
  window: {
    closeCurrent: () => window.courrier.window.closeCurrent(),
    getComposeDraft: () => window.courrier.window.getComposeDraft(),
    openComposeWindow: window.courrier.window.openComposeWindow,
  },
};
