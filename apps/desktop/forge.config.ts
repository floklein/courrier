import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const appIconBasePath = 'src/assets/icon';
const appPngIconPath = 'src/assets/icon.png';
const appWindowsIconPath = 'src/assets/icon.ico';
const requireFromConfig = createRequire(__filename);
const externalNativeDependencies = [
  '@azure/msal-node-extensions',
  '@azure/msal-node-runtime',
  'keytar',
];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extraResource: [appPngIconPath],
    icon: appIconBasePath,
  },
  hooks: {
    packageAfterPrune: async (_config, buildPath) => {
      await copyExternalNativeDependencies(buildPath);
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: 'Courrier',
      setupIcon: appWindowsIconPath,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({
      options: {
        icon: appPngIconPath,
      },
    }),
    new MakerDeb({
      options: {
        icon: appPngIconPath,
      },
    }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

async function copyExternalNativeDependencies(buildPath: string) {
  await Promise.all(
    externalNativeDependencies.map(async (dependencyName) => {
      const packageJsonPath = requireFromConfig.resolve(
        `${dependencyName}/package.json`,
      );
      const sourcePath = path.dirname(packageJsonPath);
      const targetPath = path.join(
        buildPath,
        'node_modules',
        ...dependencyName.split('/'),
      );

      await fs.rm(targetPath, { recursive: true, force: true });
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.cp(sourcePath, targetPath, {
        recursive: true,
        dereference: true,
      });
    }),
  );
}

export default config;
