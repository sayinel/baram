// §386 모드 설정(스펙 0064) — 적용 이펙트가 OS 대신 설정을 읽는다.
//
// 가짜 MediaQueryList 는 `use-settings-effects-theme-modes.test.tsx` 와 같은 모양이다 — 공유
// 폴리필(`src/test-setup.ts`)은 `matches: false` 에 no-op 리스너라 OS 전환을 발화할 수 없다.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 이 훅은 네이티브 메뉴 셋을 지연 `import()` 로 동기화한다 — theme-modes 시험과 같은 이유로 mock.
const menuIpc = vi.hoisted(() => ({
  syncMenuEnabled: vi.fn(() => Promise.resolve()),
  syncMenuLocale: vi.fn(() => Promise.resolve()),
  syncRecentMenu: vi.fn(() => Promise.resolve()),
}));
vi.mock("../../ipc/menu-locale", () => ({
  syncMenuLocale: menuIpc.syncMenuLocale,
}));
vi.mock("../../ipc/recent-menu", () => ({
  syncRecentMenu: menuIpc.syncRecentMenu,
}));
vi.mock("../../ipc/menu-enabled", () => ({
  syncMenuEnabled: menuIpc.syncMenuEnabled,
}));

import type { ThemeDef } from "../../types/theme";

import { useSettingsStore } from "../../stores/settings/store";
import { defaultColorsForBase } from "../../types/theme";
import { clearThemeVars } from "../../utils/theme-vars";
import { useSettingsEffects } from "../use-settings-effects";

const ACCENT = "--color-accent-default";
const LIGHT = defaultColorsForBase("light");
const DARK = defaultColorsForBase("dark");

const PAIRED: ThemeDef = {
  id: "custom-paired",
  modes: { dark: { colors: DARK }, light: { colors: LIGHT } },
  name: "Paired",
  source: "custom",
};

function Host() {
  useSettingsEffects(null);
  return null;
}

function installMatchMedia(matches: boolean): {
  fire: (next: boolean) => void;
} {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    addEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.add(fn);
    },
    matches,
    removeEventListener: (
      _type: string,
      fn: (e: MediaQueryListEvent) => void,
    ) => {
      listeners.delete(fn);
    },
  };
  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia;
  return {
    fire: (next) => {
      mql.matches = next;
      for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent);
    },
  };
}

function varOf(key: string): string {
  return document.documentElement.style.getPropertyValue(key);
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  clearThemeVars(document.documentElement);
  document.documentElement.removeAttribute("data-theme");
  useSettingsStore.setState({
    activeThemeId: "system",
    appearanceOverrides: {},
    colorModeSetting: "system",
    customThemes: [PAIRED],
    locale: "en",
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  useSettingsStore.setState({
    activeThemeId: "system",
    appearanceOverrides: {},
    colorModeSetting: "system",
    customThemes: [],
  });
});

describe("Baram 기본(system) — 모드 설정 (§386)", () => {
  it("전제: 두 팔레트의 강조색이 다르다", () => {
    // 아래 "라이트 자산" 단언이 아무것도 보지 못한 채 통과하지 않도록 값으로 증명한다.
    expect(LIGHT[ACCENT]).not.toBe(DARK[ACCENT]);
  });

  it("다크로 고정하면 OS 가 라이트여도 data-theme 이 dark 다", () => {
    installMatchMedia(false);
    useSettingsStore.setState({ colorModeSetting: "dark" });
    render(<Host />);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("라이트로 고정하면 OS 가 다크여도 data-theme 이 light 다", () => {
    installMatchMedia(true);
    useSettingsStore.setState({ colorModeSetting: "light" });
    render(<Host />);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  // 스펙 D7 — 무엇이 이것을 실패시키는가: 시스템에서도 `data-theme` 을 늘 넣는 구현.
  it("시스템이면 지금처럼 data-theme 을 비운다", () => {
    installMatchMedia(true);
    render(<Host />);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("고정 중 OS 가 바뀌어도 그대로다", () => {
    const media = installMatchMedia(false);
    useSettingsStore.setState({ colorModeSetting: "dark" });
    render(<Host />);
    media.fire(true);
    media.fire(false);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  // 무엇이 이것을 실패시키는가: deps 에서 `colorModeSetting` 을 빼면 설정을 바꿔도 이펙트가
  // 다시 돌지 않는다.
  it("설정을 바꾸면 곧바로 다시 적용하고, 시스템으로 돌리면 속성을 지운다", () => {
    installMatchMedia(false);
    render(<Host />);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);

    // ‼️ 블록 본문이다 — 간결 화살표(`act(() => store.set(...))`)는 persist 미들웨어의
    // `set()` 반환값(thenable)을 그대로 돌려주고, React 는 그것을 async act 모드 진입
    // 신호로 읽는다. 아무도 await 하지 않으므로 act 큐가 열린 채 남아 이 파일의 **이후
    // 모든** `render()` 가 이펙트를 한 번도 돌리지 않게 된다 — 같은 결함이
    // `use-settings-effects-theme-chrome.test.tsx` 헤더 주석에 실측(2026-09-23)으로
    // 적혀 있다(이 파일에서도 그대로 재현을 확인했다).
    act(() => {
      useSettingsStore.getState().setColorModeSetting("dark");
    });
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => {
      useSettingsStore.getState().setColorModeSetting("system");
    });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  // 무엇이 이것을 실패시키는가: `mode` 만 설정을 읽고 색 다이얼 파생의 `colorMode` 가 OS 를
  // 계속 읽으면, 다크 화면에서 다크용 배경 대비 다이얼이 아무것도 쓰지 않는다.
  it("색 다이얼도 고정한 모드를 따른다 — 다크 고정에서 다크 배경 대비가 적용된다", () => {
    installMatchMedia(false);
    useSettingsStore.setState({
      appearanceOverrides: { backgroundContrastDark: "black" },
      colorModeSetting: "dark",
    });
    render(<Host />);
    expect(varOf("--color-bg-bar")).toBe("#000000");
  });
});

describe("두 모드 · 한 모드 테마 — 모드 설정 (§386)", () => {
  it("두 모드 테마를 라이트로 고정하면 OS 가 다크여도 라이트 자산을 쓴다", () => {
    installMatchMedia(true);
    useSettingsStore.setState({
      activeThemeId: PAIRED.id,
      colorModeSetting: "light",
    });
    render(<Host />);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(varOf(ACCENT)).toBe(LIGHT[ACCENT]);
  });

  // 스펙 D4 — 무엇이 이것을 실패시키는가: 한 모드 테마에 설정을 밀어 넣는 구현.
  it("한 모드 테마(tokyo-night)는 설정과 무관하게 자기 모드다", () => {
    installMatchMedia(false);
    useSettingsStore.setState({
      activeThemeId: "tokyo-night",
      colorModeSetting: "light",
    });
    render(<Host />);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
