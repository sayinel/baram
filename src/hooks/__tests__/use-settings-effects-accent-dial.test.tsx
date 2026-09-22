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

import type { ThemeDef } from "../../types/theme";

import { useSettingsStore } from "../../stores/settings/store";
import { clearThemeVars } from "../../utils/theme-vars";
import { useSettingsEffects } from "../use-settings-effects";

const ACCENT = "--color-accent-default";
/** 강조에서 **파생되는** 키(`color-derive.ts` 의 규칙 `seed: ACCENT`, `hue: 0`). */
const FROM_ACCENT = "--color-callout-info";
/**
 * 채워진 표면(버튼 배경). 파생 29키(`DERIVED_COLOR_KEYS`)가 아니라 `DERIVED_KEYS`
 * 쪽이라, 이것을 내는 `derivedVars` 는 `applyThemeVars` 안에 있어 **인라인 갈래에서만**
 * 돈다 — cascade 갈래가 따로 챙기지 않으면 링크만 돌고 버튼은 옛 색으로 남았다.
 */
const ACCENT_SOLID = "--color-accent-solid";
/** 라이트 +60° 의 강조 짝(실측 2026-09-22). 라이트에서 solid 는 hover 시드를 고른다. */
const SHIFTED_SOLID = "#ad25eb";
/** 이동 없는 기본 라이트 팔레트의 같은 계산. 위 값과 **다르다는 것**이 전제다. */
const UNSHIFTED_SOLID = "#2563eb";
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
  // 전제를 주석이 아니라 값으로 증명한다. 두 짝이 같은 색이면 "옮겨진 강조를
  // 따라갔다" 는 아래 단언이 아무것도 보지 못한 채로 통과한다.
  it("옮긴 강조의 짝과 안 옮긴 강조의 짝이 서로 다르다 — 아래 단언의 전제", () => {
    expect(SHIFTED_SOLID).not.toBe(UNSHIFTED_SOLID);
  });

  it("system 에서 강조색 이동이 강조 계열과 그 파생만 인라인으로 쓴다", () => {
    installMatchMedia(false);
    useSettingsStore.setState({ appearanceOverrides: { accentHueShift: 60 } });

    render(<Host />);

    expect(varOf(ACCENT)).toBe("#af3bf6");
    // 강조에서 나오는 파생은 따라온다. `hue: 0` 규칙이라 강조와 같은 hex 다.
    expect(varOf(FROM_ACCENT)).toBe("#af3bf6");
    // ‼️ 채워진 표면의 짝도 따라온다. 무엇이 이것을 실패시키는가: 이 셋을 cascade
    // 갈래에서 빠뜨리면(고침 전 동작) `root.style` 에 아무것도 없어 빈 문자열이
    // 된다 — 화면에는 링크만 색이 돌고 버튼 배경은 옛 파랑으로 남는 모양이다.
    // `getComputedStyle` 이 아니라 `root.style` 을 읽는 것이 "우리가 박았다" 와
    // "cascade 가 갖고 있다" 를 가른다(생성 스타일시트도 이 변수를 정의한다).
    expect(varOf(ACCENT_SOLID)).toBe(SHIFTED_SOLID);
    expect(varOf("--color-accent-on-solid")).toBe("#ffffff");
    expect(varOf("--color-accent-solid-hover")).toBe("#9821cf");
    // ‼️ 강조와 무관한 시드·파생은 **쓰지 않는다** — cascade 가 소유한다(§364.2).
    // 여기에 값이 있으면 `prefers-color-scheme` 가 눌려 OS 전환이 멎는다.
    expect(varOf(NOT_ACCENT)).toBe("");
    expect(varOf(NOT_FROM_ACCENT)).toBe("");
    // ‼️ status 계열의 짝 여섯도 뺀다. 강조 다이얼은 status 시드를 움직이지 않으므로
    // 그 값들은 그대로이고, 박으면 얻지 않은 지식을 주장하는 것이 된다.
    expect(varOf("--color-status-danger-solid-hover")).toBe("");
    expect(varOf("--color-status-danger-on-solid")).toBe("");
    // ‼️ 색상 오프셋을 가진 파생 규칙도 뺀다 — 여기서 내면 다이얼을 1° 만 움직여도
    // 이 키들이 저작값에서 **튄다**(실측: `--color-callout-abstract` 는 `#8b5cf6`
    // 에서 `#773bf6` 으로). 근거는 `deriveIdentityColorVars` 의 doc 주석이고,
    // 무엇이 이것을 실패시키는가: 이 갈래가 `deriveColorVars` 로 되돌아가는 것이다.
    expect(varOf("--color-callout-abstract")).toBe("");
    expect(varOf("--color-callout-todo")).toBe("");
    expect(varOf("--color-graph-neighbor")).toBe("");
  });

  // 비공허성: 위 테스트의 빈 문자열 단언 둘은 **아무것도 적용되지 않아도** 통과한다.
  // 이 테스트가 0 갈래를 따로 못 박아, 위의 `toBe("#af3bf6")` 가 실제로 무언가
  // 쓰였음을 말하는 단언이 되게 한다.
  it("이동량 0 은 아무 인라인도 남기지 않는다", () => {
    installMatchMedia(false);

    render(<Host />);

    expect(varOf(ACCENT)).toBe("");
    expect(varOf(FROM_ACCENT)).toBe("");
    expect(varOf(ACCENT_SOLID)).toBe("");
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
    // 짝도 함께 모드를 탄다. 라이트에서는 대비 때문에 hover 시드가 solid 로 뽑혔고
    // (`accentSolidFill` 의 AA 갈래), 다크에서는 강조 자신이 그대로 뽑힌다 —
    // 그래서 이 값이 `SHIFTED_SOLID` 와 다른 것이 정상이다.
    expect(varOf(ACCENT_SOLID)).toBe("#b560fa");
  });
});

/**
 * 모드가 `css` 만 싣고 `tokens` 는 싣지 않는 테마 — `theme-manifest.ts` 가 허용하는
 * 모양이고, `readModeColors` 가 읽기 실패를 삼켜도 같은 결과가 된다. 이 테마의
 * 강조는 자기 스타일시트 안에 있어 우리가 읽을 수 없다.
 */
const CSS_ONLY: ThemeDef = {
  id: "custom-css-only",
  modes: { light: { css: ":root { --color-accent-default: #00ff00; }" } },
  name: "CSS only",
  source: "custom",
};

describe("§367 시드를 읽을 수 없는 테마는 건드리지 않는다", () => {
  // ‼️ 무엇이 이것을 실패시키는가: cascade 갈래의 가드가 `!inlineSeeded` 가 아니라
  // `colors === undefined` 이기만 하면, 이 테마가 그 갈래로 들어온다. 거기서 `base`
  // 는 `defaultColorsForBase` 로 되돌아가므로 **기본 팔레트**를 돌린 값을 이 테마의
  // CSS 강조 위에 박게 된다 — 사용자가 고른 적 없는 색이고, 모르는 것을 옮기지
  // 않는다는 이 계획의 규칙을 정면으로 어긴다.
  it("css 만 실은 테마에는 강조 다이얼이 아무것도 쓰지 않는다", () => {
    installMatchMedia(false);
    useSettingsStore.setState({
      activeThemeId: CSS_ONLY.id,
      appearanceOverrides: { accentHueShift: 60 },
      customThemes: [CSS_ONLY],
    });

    render(<Host />);

    expect(varOf(ACCENT)).toBe("");
    expect(varOf(FROM_ACCENT)).toBe("");
    expect(varOf(ACCENT_SOLID)).toBe("");
  });

  // 비공허성: 위 단언 셋은 다이얼이 아예 동작하지 않아도 통과한다. 같은 다이얼
  // 값이 `system` 에서는 쓰인다는 것이 이 파일 위쪽 테스트이고, 여기서는 그 대비가
  // 테마 id 하나뿐임을 고정한다.
  it("같은 다이얼 값이 system 에서는 쓰인다 — 위 단언의 대조군", () => {
    installMatchMedia(false);
    useSettingsStore.setState({
      activeThemeId: "system",
      appearanceOverrides: { accentHueShift: 60 },
      customThemes: [CSS_ONLY],
    });

    render(<Host />);

    expect(varOf(ACCENT)).toBe("#af3bf6");
  });
});
