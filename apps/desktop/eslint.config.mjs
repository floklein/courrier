import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importX from "eslint-plugin-import-x";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";

export default [
  {
    ignores: ["dist/**", ".vite/**", "out/**", "coverage/**"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    settings: {
      ...importX.flatConfigs.electron.settings,
      ...importX.flatConfigs.typescript.settings,
      "import-x/ignore": ["^virtual:darkreader-script$"],
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "import-x": importX,
    },
    rules: {
      ...tsPlugin.configs["eslint-recommended"].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      ...importX.flatConfigs.recommended.rules,
      ...importX.flatConfigs.electron.rules,
      ...importX.flatConfigs.typescript.rules,
      "import-x/no-unresolved": [
        "error",
        {
          ignore: ["^virtual:darkreader-script$"],
        },
      ],
    },
  },
];
