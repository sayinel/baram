// §365 다이얼 6 — 테마가 준 본문 타이포가 활성 편집기에 닿는다(스펙 0060 §5 · §11).
//
// ‼️ 단정은 인라인 스타일과 커스텀 속성의 **문자열 값**이다 — jsdom 은 var() 치환을 구현하지
// 않는다(`use-settings-effects-fonts.test.tsx` 머리주석과 같다).
import type { InstalledTheme } from "../../themes/theme-install";
import type { Editor } from "@tiptap/core";

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsStore } from "../../stores/settings/store";
import { usePluginStore } from "../../stores/system/plugin";
import { DEFAULT_LIGHT_PALETTE } from "../../types/generated/palette-light";
import { useSettingsEffects } from "../use-settings-effects";

// 훅의 세 네이티브 메뉴 이펙트는 지연 import 를 쓴다 — 목이 없으면 vitest 가
// 환경을 내린 뒤에 착지해 모든 테스트가 통과한 채로 런이 실패한다
// (`use-settings-effects-menu-sync.test.tsx` 와 같은 이유·같은 목).
const mocks = vi.hoisted(() => ({
  syncMenuEnabled: vi.fn(() => Promise.resolve()),
  syncMenuLocale: vi.fn(() => Promise.resolve()),
  syncRecentMenu: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../ipc/menu-locale", () => ({
  syncMenuLocale: mocks.syncMenuLocale,
}));
vi.mock("../../ipc/recent-menu", () => ({
  syncRecentMenu: mocks.syncRecentMenu,
}));
vi.mock("../../ipc/menu-enabled", () => ({
  syncMenuEnabled: mocks.syncMenuEnabled,
}));

/**
 * 훅이 편집기에서 읽는 것 전부 — `view.dom` 하나가 아니다.
 *
 * spellcheck 이펙트가 `editor.setOptions`·`editor.options.editorProps` 를
 * 만지므로 그 둘이 빠지면 폰트와 무관한 TypeError 로 죽는다. 훅의 시그니처는
 * `useSettingsEffects(editor: Editor | null)` 이고, 테스트를 통과시키려고
 * 그것을 바꾸지 않는다 — 대신 double 이 그 계약을 맞춘다.
 */
function fakeEditor(el: HTMLElement): Editor {
  return {
    options: { editorProps: {} },
    setOptions: () => undefined,
    view: { dom: el },
  } as unknown as Editor;
}

// 설치 테마를 입히면 CSS 하이드레이션 훅이 디스크를 읽을 수 있다 — `use-settings-effects-theme-revoked
// .test.tsx` 와 같은 목(이 픽스처는 `css: false` 라 불리지 않아야 하지만, 불려도 IPC 에 닿지 않게).
vi.mock("../../themes/theme-store-fs", () => ({
  readStoredThemeCss: () => Promise.resolve(null),
}));

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
    // 적용 이펙트가 실제로 입히는 테마다 — 팔레트를 실어야 색 갈래가 빈 값을 다루지 않는다.
    modes: { light: { colors: DEFAULT_LIGHT_PALETTE, css: false } },
  };
}

describe("§365 테마가 준 본문 타이포", () => {
  let surface: HTMLElement;
  let editor: Editor;

  beforeEach(() => {
    surface = document.createElement("div");
    surface.className = "tiptap";
    document.body.append(surface);
    editor = fakeEditor(surface);
    usePluginStore.setState({ revocations: null });
    useSettingsStore.setState({
      activeThemeId: "prose",
      appearanceOverrides: {},
      codeFontSize: 14,
      codeLineHeight: 1.75,
      installedThemes: {
        prose: themeWith({
          editorFontFamily: "Theme Serif",
          editorFontSize: 18,
          editorLineHeight: 2,
        }),
      },
      linkFontMetrics: true,
    });
  });

  afterEach(() => {
    surface.remove();
  });

  it("크기 · 줄 높이 · 서체가 편집기에 닿는다", () => {
    renderHook(() => useSettingsEffects(editor));
    expect(surface.style.fontSize).toBe("18px");
    expect(surface.style.lineHeight).toBe("2");
    expect(surface.style.getPropertyValue("--font-family-editor")).toContain(
      '"Theme Serif"',
    );
  });

  // 연동이 켜진 기본 상태의 계약(§354): 코드 = 본문 × 0.875 가 **병합된** 본문 위에서 선다.
  it("연동 중이면 코드 크기가 테마의 본문 크기를 따른다", () => {
    renderHook(() => useSettingsEffects(editor));
    expect(surface.style.getPropertyValue("--editor-code-font-size")).toBe(
      "15.75px",
    );
    expect(surface.style.getPropertyValue("--editor-code-line-height")).toBe(
      "2",
    );
  });

  it("사용자 층이 테마를 이긴다", () => {
    useSettingsStore.setState({ appearanceOverrides: { editorFontSize: 20 } });
    renderHook(() => useSettingsEffects(editor));
    expect(surface.style.fontSize).toBe("20px");
  });

  // 무엇이 이것을 실패시키는가: 소비자가 `activeThemeId` 로 테마 층을 짓게 되면 철회된 테마의
  // 크기가 남는다.
  it("철회된 테마의 층은 빠진다", () => {
    usePluginStore.setState({
      revocations: {
        revoked: [
          { id: "prose", reason: "r", severity: "malicious", versions: "*" },
        ],
        sequence: 1,
        version: 1,
      },
    });
    renderHook(() => useSettingsEffects(editor));
    expect(surface.style.fontSize).toBe("16px");
  });
});
