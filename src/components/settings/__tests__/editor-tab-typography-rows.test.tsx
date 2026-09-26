// §365 다이얼 6 — 에디터 탭 "글꼴" 절의 다이얼 행(스펙 0060 §7.1). 서체 행은 선택기 옆에 출처
// 칸을 붙이고, 크기 · 줄 높이는 다이얼 행이며, 코드 두 행은 값을 설명이 아니라 값 칸에 보인다.
import type { InstalledTheme } from "../../../themes/theme-install";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import en from "../../../i18n/en.json";
import { useSettingsStore } from "../../../stores/settings/store";
import { usePluginStore } from "../../../stores/system/plugin";
import { EditorTab } from "../tabs/EditorTab";

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

/** 라벨로 행을 찾는다 — `.settings-row` 가 라벨과 컨트롤을 함께 싼다. */
function row(label: string): HTMLElement {
  const el = screen.getByText(label).closest(".settings-row");
  if (!(el instanceof HTMLElement)) throw new Error(`no row for ${label}`);
  return el;
}

beforeEach(() => {
  usePluginStore.setState({ revocations: null });
  useSettingsStore.setState({
    activeThemeId: "prose",
    appearanceOverrides: {},
    installedThemes: {
      prose: themeWith({ editorFontFamily: "Theme Serif", editorFontSize: 18 }),
    },
    linkFontMetrics: true,
    locale: "en",
  });
});

describe("글꼴 절의 다이얼 행", () => {
  it("테마가 준 서체는 서체 행에 테마 출처로 보인다", () => {
    render(<EditorTab />);
    const origin = within(row(en["settings.editor.fontFamily"])).getByTestId(
      "dial-origin",
    );
    expect(origin.getAttribute("data-origin")).toBe("theme");
  });

  // 무엇이 이것을 실패시키는가: 서체 행이 되돌리기를 `resetDial` 이 아니라 기본값 쓰기로 하면
  // 사용자 층에 `""` 가 남아 테마 서체로 돌아가지 않는다.
  it("사용자가 고른 서체는 되돌리기로 테마 값에 돌아간다", () => {
    useSettingsStore.setState({
      appearanceOverrides: { editorFontFamily: "Inter" },
    });
    render(<EditorTab />);
    fireEvent.click(
      within(row(en["settings.editor.fontFamily"])).getByTestId("dial-revert"),
    );
    expect(useSettingsStore.getState().appearanceOverrides).toEqual({});
  });

  it("크기는 다이얼 행이고 값 칸이 병합값을 보인다", () => {
    render(<EditorTab />);
    const size = row(en["settings.editor.fontSize"]);
    expect(within(size).getByTestId("dial-value").textContent).toBe("18px");
    expect(
      within(size).getByTestId("dial-origin").getAttribute("data-origin"),
    ).toBe("theme");
  });

  // §354 연동 중 코드 크기 = 병합된 본문 × 0.875 → round(15.75) = 16.
  it("코드 크기는 값 칸에 보이고, 설명에는 값이 없다", () => {
    render(<EditorTab />);
    const code = row(en["settings.editor.codeFontSize"]);
    expect(within(code).getByTestId("code-font-size-value").textContent).toBe(
      "16px",
    );
    expect(code.textContent).not.toContain("{value}");
    expect(en["settings.editor.codeFontSize.desc"]).not.toContain("{value}");
  });
});
