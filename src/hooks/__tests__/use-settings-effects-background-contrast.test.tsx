// §365 다이얼 2a·2b — 배경 대비가 **적용 경로에 도달하는가**(스펙 0059 §9.3).
// `background-contrast-dials.test.ts` 는 `toVars` 의 맵까지만 보인다. 그 맵이 `<html>` 에
// 닿는지, 모드 전환·테마 전환에서 지워지는지는 이 파일의 질문이다.
//
// 하네스(메뉴 mock 셋 · 가짜 MediaQueryList · Host)는
// `use-settings-effects-accent-dial.test.tsx` 와 같고, 이유도 그 파일 머리주석과 같다.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { deriveColorVars } from "../../appearance/color-derive";
import { useSettingsStore } from "../../stores/settings/store";
import { BUILT_IN_THEMES } from "../../types/theme";
import { clearThemeVars } from "../../utils/theme-vars";
import { useSettingsEffects } from "../use-settings-effects";

/** `black`·`white` 가 같은 색으로 칠하는 넷(스펙 0059 §3.2). */
const SURFACES = [
  "--color-bg-default",
  "--color-editor-bg",
  "--color-bg-panel",
  "--color-bg-bar",
] as const;
const FILL = "--color-bg-chrome-fill";

const NORD = BUILT_IN_THEMES.find((t) => t.id === "nord")!;
const NORD_DARK = NORD.modes.dark!.colors!;
const SOLARIZED_LIGHT = BUILT_IN_THEMES.find(
  (t) => t.id === "solarized-light",
)!;

/** 훅 하나만 도는 껍데기 — 이 파일이 검사하는 것은 렌더가 아니라 DOM 부작용이다. */
function Host() {
  useSettingsEffects(null);
  return null;
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
      for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent);
    },
  };
}

function varOf(key: string): string {
  return document.documentElement.style.getPropertyValue(key);
}

/**
 * 이름이 `--color-` 로 시작하는 인라인 커스텀 프로퍼티 전부 — `CSSStyleDeclaration` 은
 * 위치로 인덱싱된다(`style.item(i)`). 다섯 다이얼 키를 하나씩 짚는 것과 달리, 이 채널
 * 위의 다른 작성자가 남긴 값도 놓치지 않는다.
 */
function inlineColorPropertyNames(): string[] {
  const style = document.documentElement.style;
  return Array.from({ length: style.length }, (_, i) => style.item(i)).filter(
    (name) => name.startsWith("--color-"),
  );
}

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  clearThemeVars(document.documentElement);
  document.documentElement.removeAttribute("data-theme");
  useSettingsStore.setState({
    activeThemeId: "system",
    appearanceOverrides: {},
    customThemes: [],
    locale: "en",
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  useSettingsStore.setState({
    activeThemeId: "system",
    appearanceOverrides: {},
    customThemes: [],
  });
});

describe("§365 배경 대비 — cascade 테마(system)", () => {
  it("다크의 black 은 표면 넷을 #000000 으로, 채움을 기본 다크 본문색으로 쓴다", () => {
    installMatchMedia(true);
    useSettingsStore.setState({
      appearanceOverrides: { backgroundContrastDark: "black" },
    });

    render(<Host />);

    for (const key of SURFACES) expect(varOf(key), key).toBe("#000000");
    expect(varOf(FILL)).toBe("#1a1a2e");
    // 움직이지 않는 키는 cascade 가 소유한다(스펙 0059 D5 · §364.2).
    expect(varOf("--color-bg-subtle")).toBe("");
    expect(varOf("--color-bg-elevated")).toBe("");
    expect(varOf("--color-accent-default")).toBe("");
  });

  // 0055 §15.1 의 모양 — 희소성 회귀. 무엇이 이것을 실패시키는가: 모드 판정이 없거나
  // `clearThemeVars` 가 역할 토큰을 놓치면 #000000 이 라이트 화면에 남는다. 마지막
  // 단언이 짝이다 — 지워진 것이 "다시는 안 쓴다" 가 아니라 "이 모드에서 안 쓴다" 임을 보인다.
  //
  // 다섯 키 루프는 이 다이얼이 낸 것만 본다 — 이 채널의 다른 작성자(강조 다이얼 등)가
  // 남긴 `--color-*` 인라인은 그 루프를 그대로 통과한다. 아래 전수 스윕이 그 이름의
  // 주장("색 인라인이 하나도 남지 않고") 을 실제로 검사한다. `<html>` 의 인라인은 색
  // 채널만 있는 것이 아니므로(예: 폰트·간격 변수, 이 파일 밖의 다른 설정 이펙트) 전체
  // `style.length === 0` 은 걸지 않는다.
  it("OS 를 라이트로 바꾸면 색 인라인이 하나도 남지 않고, 되돌리면 다시 쓴다", () => {
    const media = installMatchMedia(true);
    useSettingsStore.setState({
      appearanceOverrides: { backgroundContrastDark: "black" },
    });
    render(<Host />);
    expect(varOf("--color-bg-bar")).toBe("#000000");

    media.fire(false);
    for (const key of [...SURFACES, FILL]) expect(varOf(key), key).toBe("");
    expect(inlineColorPropertyNames()).toEqual([]);

    media.fire(true);
    expect(varOf("--color-bg-bar")).toBe("#000000");
  });

  it("라이트의 flat 은 본문을 두고 크롬·바를 본문색으로, 채움을 옛 크롬색으로 쓴다", () => {
    installMatchMedia(false);
    useSettingsStore.setState({
      appearanceOverrides: { backgroundContrastLight: "flat" },
    });

    render(<Host />);

    expect(varOf("--color-bg-panel")).toBe("#ffffff");
    expect(varOf("--color-bg-bar")).toBe("#ffffff");
    expect(varOf(FILL)).toBe("#f1f3f5");
    expect(varOf("--color-bg-default")).toBe("");
    expect(varOf("--color-editor-bg")).toBe("");
  });

  // 비공허성: 위 테스트들의 빈 문자열 단언은 아무것도 적용되지 않아도 통과한다.
  it("default 는 아무 인라인도 남기지 않는다", () => {
    installMatchMedia(true);
    render(<Host />);
    for (const key of [...SURFACES, FILL]) expect(varOf(key), key).toBe("");
  });
});

describe("§365 배경 대비 — 인라인 테마", () => {
  it("nord 의 black 은 채움에 nord 의 본문색을 쓴다", () => {
    installMatchMedia(true);
    useSettingsStore.setState({
      activeThemeId: "nord",
      appearanceOverrides: { backgroundContrastDark: "black" },
    });

    render(<Host />);

    for (const key of SURFACES) expect(varOf(key), key).toBe("#000000");
    expect(varOf(FILL)).toBe(NORD_DARK["--color-bg-default"]);
  });

  // 스펙 0059 §5 — 다이얼 출력은 시드이고, 파생은 그 **뒤**에 계산된다. 무엇이 이것을
  // 실패시키는가: 다이얼 출력을 파생 뒤에 얹으면 bg-selection 이 nord 의 원래 본문 기준
  // 값에 머문다.
  it("본문에 기대는 파생 키가 옮긴 본문에서 다시 계산된다", () => {
    installMatchMedia(true);
    useSettingsStore.setState({
      activeThemeId: "nord",
      appearanceOverrides: { backgroundContrastDark: "black" },
    });

    render(<Host />);

    const moved = deriveColorVars({
      ...NORD_DARK,
      "--color-bg-default": "#000000",
    })["--color-bg-selection"];
    const unmoved = deriveColorVars(NORD_DARK)["--color-bg-selection"];
    // 전제 — 둘이 같으면 아래 단언은 아무것도 가르지 못한다.
    expect(moved).not.toBe(unmoved);
    expect(varOf("--color-bg-selection")).toBe(moved);
  });

  // 스펙 0059 §3.1 — 모드는 `resolveColorMode` 의 답이고, 한 모드짜리 테마는 OS 를 무시한다.
  it("라이트 전용 테마에서는 OS 가 다크여도 다크 다이얼이 아무것도 쓰지 않는다", () => {
    installMatchMedia(true);
    useSettingsStore.setState({
      activeThemeId: "solarized-light",
      appearanceOverrides: { backgroundContrastDark: "black" },
    });

    render(<Host />);

    expect(varOf("--color-bg-default")).toBe(
      SOLARIZED_LIGHT.modes.light!.colors!["--color-bg-default"],
    );
    expect(varOf("--color-bg-bar")).toBe("");
    expect(varOf(FILL)).toBe("");
  });

  // #330 의 모양. 무엇이 이것을 실패시키는가: `clearThemeVars` 가 역할 토큰을 놓치면
  // system 으로 돌아와도 앞 테마의 바가 남는다. 다이얼도 함께 비워 "지우기" 만 남긴다.
  it("테마를 바꾸면 앞 테마의 역할 토큰이 남지 않는다", () => {
    installMatchMedia(true);
    useSettingsStore.setState({
      activeThemeId: "nord",
      appearanceOverrides: { backgroundContrastDark: "black" },
    });
    render(<Host />);
    expect(varOf("--color-bg-bar")).toBe("#000000");

    act(() => {
      useSettingsStore.setState({
        activeThemeId: "system",
        appearanceOverrides: {},
      });
    });

    expect(varOf("--color-bg-bar")).toBe("");
    expect(varOf(FILL)).toBe("");
  });
});

/**
 * 모드가 `css` 만 싣고 `tokens` 는 싣지 않는 테마 — `theme-manifest.ts` 가 허용하는
 * 모양이고, `readModeColors` 가 읽기 실패를 삼켜도 같은 결과가 된다
 * (`use-settings-effects-accent-dial.test.tsx` 의 같은 이름 픽스처와 동일).
 */
const CSS_ONLY: ThemeDef = {
  id: "custom-css-only",
  modes: { light: { css: ":root { --color-accent-default: #00ff00; }" } },
  name: "CSS only",
  source: "custom",
};

describe("§365 시드를 읽을 수 없는 테마는 건드리지 않는다", () => {
  // ‼️ 무엇이 이것을 실패시키는가: `use-settings-effects.ts` 의 셋째 갈래(`inlineSeeded`
  // 인데 `colors` 가 없는 테마 — 의도적 무동작)가 없으면, `white` 는 표면 넷을 시드 없이도
  // 낼 수 있으므로(`extremeVars` 의 `surface` 인자는 상수 `"#ffffff"`) 이 테마에도 값을
  // 쓴다 — 사용자가 고른 적 없는 기본 팔레트 위의 계산이다. 그래서 이 값을 골라야
  // "시드가 없으면 아무것도 안 쓴다" 는 주장이 실제로 시험된다.
  it("css 만 실은 테마에는 배경 대비 다이얼이 아무것도 쓰지 않는다", () => {
    installMatchMedia(false);
    useSettingsStore.setState({
      activeThemeId: CSS_ONLY.id,
      appearanceOverrides: { backgroundContrastLight: "white" },
      customThemes: [CSS_ONLY],
    });

    render(<Host />);

    for (const key of [...SURFACES, FILL]) expect(varOf(key), key).toBe("");
  });

  // 비공허성: 위 단언 다섯은 다이얼이 아예 동작하지 않아도 통과한다. 같은 다이얼 값이
  // system 에서는 쓰인다는 것이 대조군이고, 대비는 테마 id 하나뿐임을 고정한다.
  it("같은 다이얼 값이 system 에서는 쓰인다 — 위 단언의 대조군", () => {
    installMatchMedia(false);
    useSettingsStore.setState({
      activeThemeId: "system",
      appearanceOverrides: { backgroundContrastLight: "white" },
      customThemes: [CSS_ONLY],
    });

    render(<Host />);

    expect(varOf("--color-bg-bar")).toBe("#ffffff");
  });
});
