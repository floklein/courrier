export const api = {
  auth: {
    getSession: () => window.courrier.auth.getSession(),
    signIn: () => window.courrier.auth.signIn(),
    signOut: () => window.courrier.auth.signOut(),
  },
  mail: {
    listFolders: () => window.courrier.mail.listFolders(),
    listMessages: (folderId: string, pageUrl?: string) =>
      window.courrier.mail.listMessages(folderId, pageUrl),
    getMessage: (folderId: string, messageId: string) =>
      window.courrier.mail.getMessage(folderId, messageId),
  },
};
