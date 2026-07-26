import { spawnSync } from "node:child_process";

const action = process.argv[2] ?? "run";
const commands = {
  darwin: {
    run: [
      "swift",
      ["run", "--disable-sandbox", "--package-path", "apps/macos", "Courrier"],
    ],
    build: ["swift", ["build", "--disable-sandbox", "--package-path", "apps/macos"]],
    test: ["swift", ["test", "--disable-sandbox", "--package-path", "apps/macos"]],
    package: ["sh", ["apps/macos/Scripts/build-app.sh"]],
  },
  win32: {
    run: [
      "dotnet",
      ["run", "--project", "apps/windows/src/Courrier.Windows/Courrier.Windows.csproj"],
    ],
    build: ["dotnet", ["build", "apps/windows/Courrier.Windows.sln"]],
    test: ["dotnet", ["test", "apps/windows/Courrier.Windows.sln"]],
    package: [
      "dotnet",
      [
        "publish",
        "apps/windows/src/Courrier.Windows/Courrier.Windows.csproj",
        "--configuration",
        "Release",
      ],
    ],
  },
};

const platformCommands = commands[process.platform];
const command = platformCommands?.[action];

if (!platformCommands) {
  console.error("Courrier has native clients for macOS and Windows.");
  process.exit(1);
}

if (!command) {
  console.error(`Unknown native action: ${action}`);
  process.exit(1);
}

const [executable, args] = command;
const result = spawnSync(executable, args, {
  cwd: new URL("..", import.meta.url),
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
