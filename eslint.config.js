import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import perfectionist from "eslint-plugin-perfectionist";
import reactHooks from "eslint-plugin-react-hooks";
import { reactRefresh } from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Disable new v7 rules — codebase pre-dates these stricter checks
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
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
      // 정렬이 선언만 옮기고 주석을 두고 가면 독스트링이 엉뚱한 심볼을
      // 문서화한다 (실사고: resolveMotion 설명이 MotionOptions 위에,
      // setSelection 설명이 latchPointerExit 위에 붙었음). 주석을 파티션
      // 경계로 삼아 주석을 가로지르는 재정렬을 금지한다.
      "perfectionist/sort-classes": [
        "error",
        { partitionByComment: true, type: "natural" },
      ],
      "perfectionist/sort-modules": [
        "error",
        { partitionByComment: true, type: "natural" },
      ],
    },
  },
  {
    ignores: ["dist/", "examples/", "src-tauri/", "node_modules/"],
  },
  eslintConfigPrettier,
);
