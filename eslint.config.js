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
    // 생성물은 린트 대상이 아니다. `lint:ts` 는 `eslint src/` 라 두 generated 디렉터리가
    // 그냥 걸려들었고, 오늘 안전한 이유는 `perfectionist/sort-objects` 가 위에서 명시적으로
    // 꺼져 있다는 우연 하나뿐이다. 그것이 켜지는 날 `eslint --fix` 는 팔레트 24키를
    // 알파벳순으로 정렬하고 `npm run tokens:build` 는 THEME_COLOR_KEYS 순서로 다시 써낸다 —
    // 두 autofix 가 서로를 되돌려 `tokens:check` 의 `git diff --exit-code` 가 원인이 보이지
    // 않는 채로 영구히 빨개진다.
    ignores: [
      "dist/",
      "examples/",
      "src-tauri/",
      "node_modules/",
      "src/styles/generated/",
      "src/types/generated/",
    ],
  },
  eslintConfigPrettier,
  {
    // issue 267 — a bare `useXStore()` subscribes to the whole store, so every unrelated
    // write re-renders the caller (CLAUDE.md "Zustand 셀렉터"). Pass a selector, wrap an
    // object selector in `useShallow`, or call `useXStore.getState()` in a handler.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          message:
            "bare use*Store() subscribes to the whole store — pass a selector (useShallow for an object), or read useXStore.getState() in a handler (CLAUDE.md: Zustand 셀렉터)",
          selector:
            "CallExpression[callee.type='Identifier'][callee.name=/^use[A-Z]\\w*Store$/][arguments.length=0]",
        },
      ],
    },
  },
);
