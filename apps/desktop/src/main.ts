import 'dotenv/config';
import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  nativeTheme,
  session,
  shell,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import {
  composeWindowDraftSchema,
  type ComposeWindowDraft,
} from './lib/compose-window';
import { AuthRequiredError, AuthService } from './main/auth-service';
import { GraphClient } from './main/graph-client';
import { GmailClient } from './main/gmail-client';
import { GoogleAuthProvider } from './main/google-auth-provider';
import { registerIpcHandlers } from './main/ipc';
import { MailSubscriptionManager } from './main/mail-subscription-manager';
import { MailService } from './main/mail-service';
import { MicrosoftAuthProvider } from './main/microsoft-auth-provider';
import {
  assertTrustedSender,
  createAppUrlTrustPolicy,
  type AppUrlTrustPolicy,
  registerWindowNavigationGuards,
} from './main/security';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const composeDraftsByWebContentsId = new Map<number, ComposeWindowDraft>();

const createWindow = (trustPolicy: AppUrlTrustPolicy) => {
  const titleBarOverlay = getTitleBarOverlayOptions();
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 920,
    minHeight: 640,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 12 },
    autoHideMenuBar: true,
    titleBarOverlay,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  registerWindowNavigationGuards(mainWindow, shell.openExternal, trustPolicy);

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
  const mailService = new MailService([graphClient, gmailClient]);
  const subscriptionManager = new MailSubscriptionManager({
    authService,
    mailService,
    relayAdminToken: process.env.RELAY_ADMIN_TOKEN,
    relayPublicUrl: process.env.RELAY_PUBLIC_URL,
  });

  Menu.setApplicationMenu(null);
  registerSessionPermissionGuards();
  registerIpcHandlers(authService, mailService, {
    trustPolicy,
    startMailSubscriptions: (accountId) => subscriptionManager.start(accountId),
    stopMailSubscriptions: () =>
      subscriptionManager.stop({ deleteRemoteSubscription: true }),
  });
  registerWindowIpcHandlers(trustPolicy);
  createWindow(trustPolicy);
  void startMailSubscriptions(subscriptionManager);
  app.on('before-quit', () => {
    void subscriptionManager.stop();
  });
});

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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow(createAppUrlTrustPolicy({
      appFilePath: getRendererIndexPath(),
      devServerUrl: MAIN_WINDOW_VITE_DEV_SERVER_URL,
    }));
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
