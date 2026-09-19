// §358 테마가 실어 보낸 CSS 가 실제로 화면에 닿는 경로.
//
// `ThemeModeAssets.css` 는 0088 이 타입에만 열어 둔 필드였다 — 이 스위트가 그것을
// 처음으로 문서에 연결한다. 검사하는 것은 렌더가 아니라 DOM 부작용이다.
//
// ‼️ 두 번째 단언("누적되지 않는다")이 이 파일의 #330 이다. 붙이는 경로와 떼는 경로가
// 따로 자라면 테마를 바꿀 때마다 스타일시트가 쌓이고, 먼저 붙은 것이 계속 살아 있다.
//
// ‼️ 공유 폴리필(`src/test-setup.ts`)의 matchMedia 는 `matches: false` 에 no-op
// 리스너라 모드 전환을 발화시킬 수 없다. 그래서 `use-settings-effects-theme-modes`
// 와 같은 방식으로 **이 파일에서만** 가짜 MediaQueryList 를 깔고 끝나면 되돌린다.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ‼️ `useSettingsEffects` 는 네이티브 메뉴 세 개를 **지연** `import()` 로 동기화한다(§82).
// 하나가 vitest 의 환경 해체 뒤에 착지하면 모든 테스트가 통과한 채로 런 전체가 깨진다.
// 세 모듈을 모두 mock 하면 동적 import 가 mock 레지스트리에서 풀려 로더에 닿지 않는다.
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
import { clearThemeCss, clearThemeVars } from "../../utils/theme-vars";
import { useSettingsEffects } from "../use-settings-effects";

const ACCENT = "--color-accent-default";

/** 계약을 지키는 저장분 — sanitize + inline 을 거친 CSS 는 이 형태다. */
const layered = (body: string) => `@layer baram-theme{${body}}`;

const LIGHT_CSS = layered(".baram{--probe:light}");
const DARK_CSS = layered(".baram{--probe:dark}");
const OTHER_CSS = layered(".baram{--probe:other}");
/** 레이어 밖이다 — 앱 CSS 를 이길 수 있으므로 주입되면 안 된다. */
const REJECTED_CSS = ".baram{--probe:rejected}";

const PAIRED: ThemeDef = {
  id: "custom-paired",
  modes: {
    dark: { colors: defaultColorsForBase("dark"), css: DARK_CSS },
    light: { colors: defaultColorsForBase("light"), css: LIGHT_CSS },
  },
  name: "Paired",
  source: "custom",
};

/** CSS 만 싣고 토큰은 싣지 않는 테마 — §355 가 허용하는 조합이다. */
const CSS_ONLY: ThemeDef = {
  id: "custom-css-only",
  modes: { light: { css: OTHER_CSS } },
  name: "CSS only",
  source: "custom",
};

const NO_CSS: ThemeDef = {
  id: "custom-no-css",
  modes: { light: { colors: defaultColorsForBase("light") } },
  name: "No CSS",
  source: "custom",
};

const BAD_CSS: ThemeDef = {
  id: "custom-bad-css",
  modes: {
    light: { colors: defaultColorsForBase("light"), css: REJECTED_CSS },
  },
  name: "Bad CSS",
  source: "custom",
};

const ALL = [PAIRED, CSS_ONLY, NO_CSS, BAD_CSS];

/** 훅 하나만 도는 껍데기 — 이 파일이 검사하는 것은 렌더가 아니라 DOM 부작용이다. */
function Host() {
  useSettingsEffects(null);
  return null;
}

/** 지금 문서에 붙어 있는 테마 스타일시트 전부. 개수까지 본다 — 누적이 결함이다. */
function themeStyles(): HTMLStyleElement[] {
  return Array.from(
    document.querySelectorAll<HTMLStyleElement>("style[data-baram-theme]"),
  );
}

/** 가짜 MediaQueryList. `matches` 를 바꾸고 `change` 를 실제로 발화할 수 있다. */
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
      // 리스너는 이벤트가 아니라 `mql.matches` 를 읽는다 — 먼저 바꾸고 부른다.
      mql.matches = next;
      act(() => {
        for (const fn of listeners)
          fn({ matches: next } as MediaQueryListEvent);
      });
    },
  };
}

function selectTheme(id: string): void {
  act(() => {
    useSettingsStore.setState({ activeThemeId: id });
  });
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  clearThemeVars(document.documentElement);
  clearThemeCss(document);
  document.documentElement.removeAttribute("data-theme");
  useSettingsStore.setState({
    activeThemeId: PAIRED.id,
    customThemes: ALL,
    locale: "en",
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  clearThemeCss(document);
  useSettingsStore.setState({ activeThemeId: "system", customThemes: [] });
});

describe("테마 CSS 주입", () => {
  it("테마의 css가 <style data-baram-theme> 로 주입된다", () => {
    installMatchMedia(false);
    render(<Host />);

    const styles = themeStyles();
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe(LIGHT_CSS);
    expect(styles[0].parentElement).toBe(document.head);
  });

  it("‼️ 테마를 바꾸면 이전 테마의 <style> 이 사라진다 — 누적되지 않는다", () => {
    installMatchMedia(false);
    render(<Host />);
    expect(themeStyles()[0].textContent).toBe(LIGHT_CSS);

    selectTheme(CSS_ONLY.id);

    // 개수가 이 단언의 핵심이다. 덮어쓰기만 하고 떼지 않으면 앞 장이 살아남아
    // 두 테마가 동시에 그린다 — 그것이 #330 의 모양이다.
    const styles = themeStyles();
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe(OTHER_CSS);
  });

  it("css 가 없는 테마로 바꾸면 <style> 이 남지 않는다", () => {
    installMatchMedia(false);
    render(<Host />);
    expect(themeStyles()).toHaveLength(1);

    selectTheme(NO_CSS.id);
    expect(themeStyles()).toHaveLength(0);

    // system 은 테마 정의를 찾지도 않는 갈래다 — 그 이른 반환에서도 떼야 한다.
    selectTheme(PAIRED.id);
    expect(themeStyles()).toHaveLength(1);
    selectTheme("system");
    expect(themeStyles()).toHaveLength(0);
  });

  it("검증에 실패한 css는 주입하지 않고 토큰만 적용한다", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    installMatchMedia(false);
    selectTheme(BAD_CSS.id);
    render(<Host />);

    expect(themeStyles()).toHaveLength(0);
    // 토큰은 그대로 적용된다 — CSS 하나 때문에 테마 전체를 버리지 않는다.
    expect(document.documentElement.style.getPropertyValue(ACCENT)).toBe(
      defaultColorsForBase("light")[ACCENT],
    );
    // 조용히 사라지면 진단할 수 없다.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it("모드가 바뀌면 그 모드의 css로 교체된다", () => {
    const media = installMatchMedia(false);
    render(<Host />);
    expect(themeStyles()[0].textContent).toBe(LIGHT_CSS);

    media.fire(true);

    expect(document.documentElement.dataset.theme).toBe("dark");
    const styles = themeStyles();
    expect(styles).toHaveLength(1);
    expect(styles[0].textContent).toBe(DARK_CSS);
  });
});
