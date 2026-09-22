// §367 강조색 다이얼이 **적용 경로에 실제로 도달하는가**. `accent-dials.test.ts` 는
// `toVars` 가 옳은 hex 를 낸다는 것까지만 보이고, 그 맵이 `<html>` 에 닿는지는 다른
// 질문이다 — 다이얼을 `applyDialVars` 에 맡기면 계산은 그대로 옳으면서 화면은 변하지
// 않는다(`clearThemeVars` 가 그 다음 줄에서 지운다. Task 4 의 순서 회귀 테스트).
//
// ‼️ 공유 폴리필(`src/test-setup.ts`)은 `matches: false` 에 no-op 리스너라 OS 전환
// 분기가 돌지 않는다. 그래서 **이 파일에서만** 가짜 MediaQueryList 로 덮고 끝나면
// 되돌린다 — 공유 폴리필은 다른 스위트가 그 모양에 의존하므로 건드리지 않는다.
// (`use-settings-effects-theme-modes.test.tsx` 와 같은 이유·같은 헬퍼다.)
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ‼️ `useSettingsEffects` 는 네이티브 메뉴 세 개를 **지연** `import()` 로 동기화한다(§82).
// 이 파일이 그 훅을 부르므로 그 로드가 여기서 시작되고, 하나가 vitest 의 환경 해체
// 뒤에 착지하면 모든 테스트가 통과한 채로 `EnvironmentTeardownError` 가 런 전체를
// 깨뜨린다. 세 모듈을 모두 mock 하면 동적 import 가 mock 레지스트리에서 풀려 로더에
// 닿지 않는다 (`use-settings-effects-theme-modes.test.tsx` 와 같은 목록).
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

import { useSettingsStore } from "../../stores/settings/store";
import { clearThemeVars } from "../../utils/theme-vars";
import { useSettingsEffects } from "../use-settings-effects";

const ACCENT = "--color-accent-default";
/** 강조에서 **파생되는** 키(`color-derive.ts` 의 규칙 `seed: ACCENT`, `hue: 0`). */
const FROM_ACCENT = "--color-callout-info";
/** 강조와 무관한 시드. cascade 가 소유하므로 인라인에 나타나면 안 된다. */
const NOT_ACCENT = "--color-bg-default";
/** 강조와 무관한 시드에서 파생되는 키(`seed: --color-status-danger`). */
const NOT_FROM_ACCENT = "--color-callout-danger";

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

describe("§367 강조색 다이얼이 cascade 테마에 닿는다", () => {
  it("system 에서 강조색 이동이 강조 계열과 그 파생만 인라인으로 쓴다", () => {
    installMatchMedia(false);
    useSettingsStore.setState({ appearanceOverrides: { accentHueShift: 60 } });

    render(<Host />);

    expect(varOf(ACCENT)).toBe("#af3bf6");
    // 강조에서 나오는 파생은 따라온다. `hue: 0` 규칙이라 강조와 같은 hex 다.
    expect(varOf(FROM_ACCENT)).toBe("#af3bf6");
    // ‼️ 강조와 무관한 시드·파생은 **쓰지 않는다** — cascade 가 소유한다(§364.2).
    // 여기에 값이 있으면 `prefers-color-scheme` 가 눌려 OS 전환이 멎는다.
    expect(varOf(NOT_ACCENT)).toBe("");
    expect(varOf(NOT_FROM_ACCENT)).toBe("");
  });

  // 비공허성: 위 테스트의 빈 문자열 단언 둘은 **아무것도 적용되지 않아도** 통과한다.
  // 이 테스트가 0 갈래를 따로 못 박아, 위의 `toBe("#af3bf6")` 가 실제로 무언가
  // 쓰였음을 말하는 단언이 되게 한다.
  it("이동량 0 은 아무 인라인도 남기지 않는다", () => {
    installMatchMedia(false);

    render(<Host />);

    expect(varOf(ACCENT)).toBe("");
    expect(varOf(FROM_ACCENT)).toBe("");
  });

  // ‼️ 이 계획이 "첫 모드 의존 다이얼" 이라고 부르는 것의 시험이다. 코드에 모드
  // 분기가 없고, 차이는 `ctx.seeds` 가 그 모드의 팔레트라는 데서만 온다.
  // 무엇이 이것을 실패시키는가: 시드를 `defaultColorsForBase("light")` 로 고정하면
  // 전환 뒤에도 `#af3bf6` 가 남는다.
  it("OS 를 전환하면 같은 다이얼 값이 다크 hex 를 낸다", () => {
    const media = installMatchMedia(false);
    useSettingsStore.setState({ appearanceOverrides: { accentHueShift: 60 } });
    render(<Host />);
    expect(varOf(ACCENT)).toBe("#af3bf6");

    media.fire(true);

    expect(varOf(ACCENT)).toBe("#b560fa");
  });
});
