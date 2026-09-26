// §365 다이얼 6 — 병합값을 읽는 두 입구(스펙 0060 §4.1). 훅과 React 밖 읽기는 같은 계산이어야
// 한다 — 어긋나면 수식 팝오버만 다른 서체를 입는다.
import type { InstalledTheme } from "../../themes/theme-install";

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { usePluginStore } from "../../stores/system/plugin";
import {
  readEditorTypography,
  useEditorTypography,
} from "../use-editor-typography";

function themeWith(dials: Record<string, number | string>): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.0.0",
    id: "prose",
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: "/home/u/.baram/themes/prose",
    manifest: {
      author: "a",
      description: "d",
      dials,
      engines: { baram: ">=0.7.0" },
      id: "prose",
      license: "MIT",
      modes: { light: { tokens: "t.json" } },
      name: "prose",
      version: "1.0.0",
    },
    modes: { light: { css: false } },
  };
}

beforeEach(() => {
  usePluginStore.setState({ revocations: null });
  useSettingsStore.setState({
    activeThemeId: "prose",
    appearanceOverrides: {},
    installedThemes: {
      prose: themeWith({ editorFontFamily: "Theme Serif", editorFontSize: 18 }),
    },
  });
});

describe("useEditorTypography", () => {
  it("테마 층을 읽는다", () => {
    const { result } = renderHook(() => useEditorTypography());
    expect(result.current.fontSize).toBe(18);
    expect(result.current.fontFamily).toBe("Theme Serif");
  });

  it("사용자 층이 이긴다", () => {
    useSettingsStore.setState({ appearanceOverrides: { editorFontSize: 20 } });
    const { result } = renderHook(() => useEditorTypography());
    expect(result.current.fontSize).toBe(20);
  });
});

describe("readEditorTypography", () => {
  it("훅과 같은 답", () => {
    const { result } = renderHook(() => useEditorTypography());
    expect(readEditorTypography()).toEqual(result.current);
  });

  // 무엇이 이것을 실패시키는가: React 밖 입구가 `activeThemeId` 를 그대로 쓰면 철회된 테마의
  // 층이 이 경로에만 남는다 — 훅은 `useEffectiveThemeId` 로 벗긴다.
  it("철회된 테마의 층을 훅과 똑같이 벗긴다", () => {
    usePluginStore.setState({
      revocations: {
        revoked: [
          { id: "prose", reason: "r", severity: "malicious", versions: "*" },
        ],
        sequence: 1,
        version: 1,
      },
    });
    const { result } = renderHook(() => useEditorTypography());
    expect(result.current.fontSize).toBe(16);
    expect(readEditorTypography()).toEqual(result.current);
  });
});
