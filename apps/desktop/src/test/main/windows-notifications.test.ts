import { describe, expect, it, vi } from 'vitest';
import { configureWindowsNotificationIdentity } from '@/main/windows-notifications';

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

  it('leaves packaged Windows Squirrel identity to Electron', () => {
    const electronApp = {
      isPackaged: true,
      setAppUserModelId: vi.fn(),
    };

    configureWindowsNotificationIdentity({
      electronApp,
      execPath: 'C:\\app\\Courrier.exe',
      platform: 'win32',
    });

    expect(electronApp.setAppUserModelId).not.toHaveBeenCalled();
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
