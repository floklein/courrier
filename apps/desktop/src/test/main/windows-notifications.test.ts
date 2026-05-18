import { describe, expect, it, vi } from 'vitest';
import {
  configureWindowsNotificationIdentity,
  squirrelAppUserModelId,
} from '@/main/windows-notifications';

describe('configureWindowsNotificationIdentity', () => {
  it('sets the AppUserModelID to the Electron executable in Windows development', () => {
    const electronApp = {
      isPackaged: false,
      setAppUserModelId: vi.fn(),
    };

    configureWindowsNotificationIdentity({
      electronApp,
      execPath: 'C:\\app\\node_modules\\electron\\dist\\electron.exe',
      platform: 'win32',
    });

    expect(electronApp.setAppUserModelId).toHaveBeenCalledWith(
      'C:\\app\\node_modules\\electron\\dist\\electron.exe',
    );
  });

  it('sets the Squirrel AppUserModelID in packaged Windows builds', () => {
    const electronApp = {
      isPackaged: true,
      setAppUserModelId: vi.fn(),
    };

    configureWindowsNotificationIdentity({
      electronApp,
      execPath: 'C:\\app\\Courrier.exe',
      platform: 'win32',
    });

    expect(electronApp.setAppUserModelId).toHaveBeenCalledWith(
      squirrelAppUserModelId,
    );
  });

  it('leaves non-Windows notification identity to the runtime', () => {
    const electronApp = {
      isPackaged: false,
      setAppUserModelId: vi.fn(),
    };

    configureWindowsNotificationIdentity({
      electronApp,
      execPath: '/Applications/Courrier.app',
      platform: 'darwin',
    });

    expect(electronApp.setAppUserModelId).not.toHaveBeenCalled();
  });
});
