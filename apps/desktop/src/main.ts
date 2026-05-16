import 'dotenv/config';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  ipcMain,
  nativeTheme,
  session,
  shell,
  Tray,
} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import started from 'electron-squirrel-startup';
import {
  composeWindowDraftSchema,
  type ComposeWindowDraft,
} from '@/lib/compose-window';
import { AuthRequiredError, AuthService } from '@/main/auth-service';
import { GraphClient } from '@/main/graph-client';
import { GmailClient } from '@/main/gmail-client';
import { GoogleAuthProvider } from '@/main/google-auth-provider';
import { registerIpcHandlers } from '@/main/ipc';
import { LocalAttachmentStore } from '@/main/local-attachment-store';
import { MailSubscriptionManager } from '@/main/mail-subscription-manager';
import { MailNotificationService } from '@/main/mail-notification-service';
import { MailService } from '@/main/mail-service';
import { MicrosoftAuthProvider } from '@/main/microsoft-auth-provider';
import {
  assertTrustedSender,
  createAppUrlTrustPolicy,
  type AppUrlTrustPolicy,
  registerWindowNavigationGuards,
} from '@/main/security';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const composeDraftsByWebContentsId = new Map<number, ComposeWindowDraft>();
let mainWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isExplicitQuit = false;
let isKeepingMainWindowInTray = false;

export function getWindowIconPath() {
  return path.join(app.getAppPath(), 'src/assets/icon.png');
}

const createWindow = (trustPolicy: AppUrlTrustPolicy) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    isKeepingMainWindowInTray = false;
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  const titleBarOverlay = getTitleBarOverlayOptions();
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 12 },
    autoHideMenuBar: true,
    icon: getWindowIconPath(),
    titleBarOverlay,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  registerWindowNavigationGuards(mainWindow, shell.openExternal, trustPolicy);
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools();
  }

  return mainWindow;
};

const createComposeWindow = (
  draft: ComposeWindowDraft,
  trustPolicy: AppUrlTrustPolicy,
) => {
  const composeWindow = new BrowserWindow({
    width: 720,
    height: 720,
    minWidth: 520,
    minHeight: 520,
    title: 'New message',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 12 },
    autoHideMenuBar: true,
    icon: getWindowIconPath(),
    titleBarOverlay: getTitleBarOverlayOptions(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const composeWebContentsId = composeWindow.webContents.id;

  composeDraftsByWebContentsId.set(composeWebContentsId, draft);
  composeWindow.on('closed', () => {
    composeDraftsByWebContentsId.delete(composeWebContentsId);
  });
  registerWindowNavigationGuards(composeWindow, shell.openExternal, trustPolicy);

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    composeWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/compose`);
  } else {
    composeWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { hash: 'compose' },
    );
  }
};

function getTitleBarOverlayOptions() {
  return {
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#ffffff' : '#171717',
    height: 63,
  };
}

nativeTheme.on('updated', () => {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.setTitleBarOverlay(getTitleBarOverlayOptions());
  });
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  const trustPolicy = createAppUrlTrustPolicy({
    appFilePath: getRendererIndexPath(),
    devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
  });
  const microsoftAuthProvider = new MicrosoftAuthProvider();
  const googleAuthProvider = new GoogleAuthProvider();
  const graphClient = new GraphClient(microsoftAuthProvider);
  const gmailClient = new GmailClient(googleAuthProvider);
  const providers = [
    { auth: microsoftAuthProvider, mail: graphClient },
    { auth: googleAuthProvider, mail: gmailClient },
  ];
  const authService = new AuthService(providers);
  const localAttachmentStore = new LocalAttachmentStore();
  const mailService = new MailService([graphClient, gmailClient], localAttachmentStore);
  const mailNotificationService = new MailNotificationService({
    icon: getWindowIconPath(),
    mailService,
    onNotificationClick: (message) => {
      const window = createWindow(trustPolicy);
      openMessageWhenWindowReady(window, message.folderId, message.id);
    },
  });
  const subscriptionManager = new MailSubscriptionManager({
    authService,
    mailNotificationService,
    mailService,
    relayAdminToken: process.env.RELAY_ADMIN_TOKEN,
    relayPublicUrl: process.env.RELAY_PUBLIC_URL,
  });

  Menu.setApplicationMenu(null);
  registerSessionPermissionGuards();
  registerIpcHandlers(authService, mailService, {
    trustPolicy,
    startMailSubscriptions: () => subscriptionManager.start(),
    stopMailSubscriptions: (accountId) =>
      subscriptionManager.stopAccount(accountId, {
        deleteRemoteSubscription: true,
      }),
  });
  registerWindowIpcHandlers(trustPolicy);
  registerNotificationIpcHandlers(trustPolicy, mailNotificationService);
  registerAttachmentIpcHandlers(trustPolicy, localAttachmentStore, mailService);
  const window = createWindow(trustPolicy);
  registerMainWindowCloseBehavior(window, mailNotificationService);
  configureTray(trustPolicy);
  void startMailSubscriptions(subscriptionManager);
  app.on('before-quit', () => {
    isExplicitQuit = true;
    void subscriptionManager.stop();
  });
});

function sendOpenMessageToWindow(
  window: BrowserWindow,
  folderId: string,
  messageId: string,
) {
  window.show();
  window.focus();
  window.webContents.send('mail:open-message', { folderId, messageId });
}

function openMessageWhenWindowReady(
  window: BrowserWindow,
  folderId: string,
  messageId: string,
) {
  let didOpen = false;
  const openMessage = () => {
    if (didOpen) {
      return;
    }

    didOpen = true;
    sendOpenMessageToWindow(window, folderId, messageId);
  };

  window.once('ready-to-show', openMessage);
  if (window.webContents.isLoading()) {
    window.webContents.once('did-finish-load', openMessage);
    return;
  }

  openMessage();
}

function registerMainWindowCloseBehavior(
  window: BrowserWindow,
  mailNotificationService: MailNotificationService,
) {
  window.on('close', async (event) => {
    if (isExplicitQuit) {
      return;
    }

    const settings = await mailNotificationService.getSettings();

    if (!settings.enabled || !mailNotificationService.isSupported()) {
      isKeepingMainWindowInTray = false;
      return;
    }

    event.preventDefault();
    isKeepingMainWindowInTray = true;
    window.hide();
  });
}

function configureTray(trustPolicy: AppUrlTrustPolicy) {
  if (tray) {
    return;
  }

  tray = new Tray(getWindowIconPath());
  tray.setToolTip('Courrier');
  tray.on('double-click', () => {
    createWindow(trustPolicy);
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open',
        click: () => {
          createWindow(trustPolicy);
        },
      },
      {
        label: 'Close',
        click: () => {
          isExplicitQuit = true;
          app.quit();
        },
      },
    ]),
  );
}

function registerWindowIpcHandlers(trustPolicy: AppUrlTrustPolicy) {
  ipcMain.handle('window:open-compose', (event, draft: ComposeWindowDraft) => {
    assertTrustedSender(event, trustPolicy);
    createComposeWindow(parseIpcPayload(composeWindowDraftSchema, draft), trustPolicy);
  });
  ipcMain.handle('window:get-compose-draft', (event) => {
    assertTrustedSender(event, trustPolicy);
    return composeDraftsByWebContentsId.get(event.sender.id);
  });
  ipcMain.handle('window:close-current', (event) => {
    assertTrustedSender(event, trustPolicy);
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

function registerNotificationIpcHandlers(
  trustPolicy: AppUrlTrustPolicy,
  mailNotificationService: MailNotificationService,
) {
  ipcMain.handle('notifications:get-settings', (event) => {
    assertTrustedSender(event, trustPolicy);
    return mailNotificationService.getSettings();
  });
  ipcMain.handle('notifications:update-settings', (event, settings: unknown) => {
    assertTrustedSender(event, trustPolicy);

    if (typeof settings !== 'object' || settings === null) {
      throw new Error('Invalid IPC payload');
    }

    const candidate = settings as Record<string, unknown>;
    return mailNotificationService.updateSettings({
      ...(typeof candidate.enabled === 'boolean'
        ? { enabled: candidate.enabled }
        : {}),
      ...(typeof candidate.includePreview === 'boolean'
        ? { includePreview: candidate.includePreview }
        : {}),
      ...(typeof candidate.silent === 'boolean'
        ? { silent: candidate.silent }
        : {}),
    });
  });
}

function registerAttachmentIpcHandlers(
  trustPolicy: AppUrlTrustPolicy,
  localAttachmentStore: LocalAttachmentStore,
  mailService: MailService,
) {
  const assertSender = (event: Electron.IpcMainInvokeEvent) =>
    assertTrustedSender(event, trustPolicy);

  ipcMain.handle('attachment:pick-local', async (event) => {
    assertSender(event);
    const parent = BrowserWindow.fromWebContents(event.sender);
    const result = parent
      ? await dialog.showOpenDialog(parent, {
          properties: ['openFile', 'multiSelections'],
        })
      : await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
        });

    if (result.canceled) {
      return [];
    }

    return localAttachmentStore.registerFiles(
      result.filePaths.map((filePath) => ({ path: filePath })),
    );
  });

  ipcMain.handle('attachment:register-local-files', async (event, files: unknown) => {
    assertSender(event);
    return localAttachmentStore.registerFiles(parseLocalFilesPayload(files));
  });

  ipcMain.handle(
    'attachment:open',
    async (
      event,
      accountId: string,
      messageId: string,
      attachmentId: string,
    ) => {
      assertSender(event);
      const attachment = await mailService.downloadAttachment(
        parseIpcPayload(idSchema, accountId),
        parseIpcPayload(idSchema, messageId),
        parseIpcPayload(idSchema, attachmentId),
      );
      const tempPath = path.join(
        app.getPath('temp'),
        'courrier-attachments',
        randomUUID(),
        sanitizeFileName(attachment.name),
      );

      await fs.mkdir(path.dirname(tempPath), { recursive: true });
      await fs.writeFile(tempPath, attachment.content);

      const error = await shell.openPath(tempPath);

      if (error) {
        throw new Error(error);
      }
    },
  );

  ipcMain.handle(
    'attachment:download',
    async (
      event,
      accountId: string,
      messageId: string,
      attachmentId: string,
    ) => {
      assertSender(event);
      const attachment = await mailService.downloadAttachment(
        parseIpcPayload(idSchema, accountId),
        parseIpcPayload(idSchema, messageId),
        parseIpcPayload(idSchema, attachmentId),
      );
      const parent = BrowserWindow.fromWebContents(event.sender);
      const result = parent
        ? await dialog.showSaveDialog(parent, {
            defaultPath: sanitizeFileName(attachment.name),
          })
        : await dialog.showSaveDialog({
            defaultPath: sanitizeFileName(attachment.name),
          });

      if (result.canceled || !result.filePath) {
        return false;
      }

      await fs.writeFile(result.filePath, attachment.content);
      return true;
    },
  );
}

function parseIpcPayload<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
) {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new Error('Invalid IPC payload');
  }

  return result.data;
}

const idSchema: {
  safeParse: (
    value: unknown,
  ) => { success: true; data: string } | { success: false };
} = {
  safeParse(value: unknown) {
    return typeof value === 'string' && value.length > 0 && value.length <= 2048
      ? { success: true as const, data: value }
      : { success: false as const };
  },
};

function parseLocalFilesPayload(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('Invalid IPC payload');
  }

  return value.map((file) => {
    if (typeof file !== 'object' || file === null) {
      throw new Error('Invalid IPC payload');
    }

    const candidate = file as Record<string, unknown>;

    if (
      typeof candidate.path !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.contentType !== 'string' ||
      typeof candidate.size !== 'number'
    ) {
      throw new Error('Invalid IPC payload');
    }

    return {
      path: candidate.path,
      name: candidate.name,
      contentType: candidate.contentType,
      size: candidate.size,
    };
  });
}

function sanitizeFileName(name: string) {
  return name.replaceAll(/[<>:"/\\|?*\u0000-\u001F]/g, '_').trim() || 'attachment';
}

function registerSessionPermissionGuards() {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function getRendererIndexPath() {
  return path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
}

async function startMailSubscriptions(subscriptionManager: MailSubscriptionManager) {
  try {
    await subscriptionManager.start();
  } catch (error) {
    if (error instanceof AuthRequiredError) {
      return;
    }

    console.warn('Mail subscription startup failed.', error);
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !isKeepingMainWindowInTray) {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    const trustPolicy = createAppUrlTrustPolicy({
      appFilePath: getRendererIndexPath(),
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    });
    createWindow(trustPolicy);
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
