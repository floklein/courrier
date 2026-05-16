export const api = {
  attachments: {
    pickLocal: () => window.courrier.attachments.pickLocal(),
    registerDroppedFiles: window.courrier.attachments.registerDroppedFiles,
    open: window.courrier.attachments.open,
    download: window.courrier.attachments.download,
  },
  auth: {
    getSession: () => window.courrier.auth.getSession(),
    signIn: window.courrier.auth.signIn,
    switchAccount: window.courrier.auth.switchAccount,
    signOut: window.courrier.auth.signOut,
  },
  mail: {
    listFolders: window.courrier.mail.listFolders,
    listMessages: window.courrier.mail.listMessages,
    getMessage: window.courrier.mail.getMessage,
    markMessageReadState: window.courrier.mail.markMessageReadState,
    moveMessage: window.courrier.mail.moveMessage,
    deleteMessage: window.courrier.mail.deleteMessage,
    listPeople: window.courrier.mail.listPeople,
    sendMessage: window.courrier.mail.sendMessage,
    replyToMessage: window.courrier.mail.replyToMessage,
    onRemoteChange: window.courrier.mail.onRemoteChange,
  },
  drafts: {
    list: window.courrier.drafts.list,
    get: window.courrier.drafts.get,
    save: window.courrier.drafts.save,
    delete: window.courrier.drafts.delete,
    send: window.courrier.drafts.send,
  },
  window: {
    closeCurrent: () => window.courrier.window.closeCurrent(),
    getComposeDraft: () => window.courrier.window.getComposeDraft(),
    openComposeWindow: window.courrier.window.openComposeWindow,
  },
};
