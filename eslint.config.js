import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import { reactRefresh } from "eslint-plugin-react-refresh";
import perfectionist from "eslint-plugin-perfectionist";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
    },
  },
  reactRefresh.configs.vite(),
  {
    rules: {
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
  perfectionist.configs["recommended-natural"],
  {
    rules: {
      "perfectionist/sort-imports": [
        "error",
        {
          type: "natural",
          groups: [
            "react",
            "tauri",
            "type",
            ["builtin", "external"],
            "internal",
            ["parent", "sibling", "index"],
            "unknown",
          ],
          customGroups: [
            {
              groupName: "react",
              elementNamePattern: "^react$|^react-.+|^react/.+",
            },
            {
              groupName: "tauri",
              elementNamePattern: "^@tauri-apps/.+",
            },
          ],
          newlinesBetween: 1,
        },
      ],
      "perfectionist/sort-objects": "off",
    },
  },
  {
    ignores: ["dist/", "src-tauri/", "node_modules/"],
  },
  eslintConfigPrettier,
);
