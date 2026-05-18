import { app } from 'electron';

interface WindowsNotificationIdentityOptions {
  electronApp?: Pick<typeof app, 'isPackaged' | 'setAppUserModelId'>;
  execPath?: string;
  platform?: NodeJS.Platform;
}

export const squirrelAppUserModelId = 'com.squirrel.Courrier.Courrier';

export function configureWindowsNotificationIdentity({
  electronApp = app,
  execPath = process.execPath,
  platform = process.platform,
}: WindowsNotificationIdentityOptions = {}) {
  if (platform !== 'win32') {
    return;
  }

  electronApp.setAppUserModelId(
    electronApp.isPackaged ? squirrelAppUserModelId : execPath,
  );
}
