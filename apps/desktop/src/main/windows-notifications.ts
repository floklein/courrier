import { app } from 'electron';

interface WindowsNotificationIdentityOptions {
  electronApp?: Pick<typeof app, 'isPackaged' | 'setAppUserModelId'>;
  execPath?: string;
  platform?: NodeJS.Platform;
}

export function configureWindowsNotificationIdentity({
  electronApp = app,
  execPath = process.execPath,
  platform = process.platform,
}: WindowsNotificationIdentityOptions = {}) {
  if (platform !== 'win32' || electronApp.isPackaged) {
    return;
  }

  electronApp.setAppUserModelId(execPath);
}
