// §357 쌍을 가진 테마는 OS 전환을 따라간다 — 그것이 matchMedia 리스너의 존재 이유다.
//
// 그전까지 `system` 은 인라인 변수를 아예 쓰지 않고 cascade 에만 의존했으므로 OS
// 전환을 들을 이유가 없었다. 쌍을 가진 테마는 인라인 토큰을 쓰고, 미디어 쿼리는
// 인라인 스타일을 바꿔 주지 않는다 — 리스너가 없으면 OS 를 다크로 바꾼 사용자가
// 라이트 팔레트에 갇힌다. 오늘은 내장 8개 중 쌍을 가진 것이 없어 프로덕션에서
// 닿지 않는 경로지만(계획 0090 이 그것을 바꾼다), 그때 리스너가 깨지면 알려 줄
// 실패가 하나도 없었다.
//
// ‼️ 공유 폴리필(`src/test-setup.ts`)은 `matches: false` 에 no-op 리스너라 두 분기
// 모두 돌지 않는다. 그래서 **이 파일에서만** 가짜 MediaQueryList 로 덮고 끝나면
// 되돌린다 — 공유 폴리필은 다른 스위트가 그 모양에 의존하므로 건드리지 않는다.
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ‼️ `useSettingsEffects` 는 네이티브 메뉴 세 개를 **지연** `import()` 로 동기화한다(§82).
// 이 파일이 그 훅을 부르므로 그 로드가 여기서 시작되고, 하나가 vitest 의 환경 해체
// 뒤에 착지하면 모든 테스트가 통과한 채로 `EnvironmentTeardownError` 가 런 전체를
// 깨뜨린다. 세 모듈을 모두 mock 하면 동적 import 가 mock 레지스트리에서 풀려 로더에
// 닿지 않는다 (`ThemeEditor.test.tsx` 와 같은 이유·같은 목록).
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

import type { ThemeColors, ThemeDef } from "../../types/theme";

import { ThemeEditor } from "../../components/settings/ThemeEditor";
import { useSettingsStore } from "../../stores/settings/store";
import { defaultColorsForBase, THEME_COLOR_KEYS } from "../../types/theme";
import { clearThemeVars } from "../../utils/theme-vars";
import { useSettingsEffects } from "../use-settings-effects";

const ACCENT = "--color-accent-default";
const ACCENT_LABEL = THEME_COLOR_KEYS.find((e) => e.key === ACCENT)!.label;
const SENTINEL = "#123456";
/** 다크 팔레트에서 **일부러 뺀** 키 — 아래 "덮어쓴 게 아니라 지워졌다"의 관측 지점. */
const DROPPED = "--color-bg-input";

const LIGHT = defaultColorsForBase("light");
// 저장된 테마는 런타임 캐스트라 키가 빠져 있을 수 있다(옛 저장분·나중에 추가된 키).
// applyThemeVars 는 빠진 키를 쓰지 않으므로, 이 키가 전환 뒤에 남아 있다면 그것은
// 앞 모드의 잔여물이다 — #330 이 정확히 그 부류의 결함이었다.
const DARK: ThemeColors = (() => {
  const full = { ...defaultColorsForBase("dark") } as Record<string, string>;
  delete full[DROPPED];
  return full as unknown as ThemeColors;
})();

const PAIRED: ThemeDef = {
  id: "custom-paired",
  modes: { dark: { colors: DARK }, light: { colors: LIGHT } },
  name: "Paired",
  source: "custom",
};

/** 훅 하나만 도는 껍데기 — 이 파일이 검사하는 것은 렌더가 아니라 DOM 부작용이다. */
function Host() {
  useSettingsEffects(null);
  return null;
}

/** 가짜 MediaQueryList. `matches` 를 바꾸고 `change` 를 실제로 발화할 수 있다. */
function installMatchMedia(matches: boolean): {
  fire: (next: boolean) => void;
  listenerCount: () => number;
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
    listenerCount: () => listeners.size,
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
    activeThemeId: PAIRED.id,
    customThemes: [PAIRED],
    locale: "en",
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  useSettingsStore.setState({ activeThemeId: "system", customThemes: [] });
});

describe("paired theme follows the OS", () => {
  it("두 모드의 accent 가 서로 다르다 — 아래 단언들의 전제", () => {
    // 전제를 주석이 아니라 값으로 증명한다. 두 팔레트가 같은 색이면 "모드가
    // 바뀌었다"는 아래 단언이 아무것도 보지 못한 채로 통과한다.
    expect(LIGHT[ACCENT]).not.toBe(DARK[ACCENT]);
    expect(LIGHT[DROPPED]).toBeTruthy();
    expect(DROPPED in DARK).toBe(false);
  });

  it("OS 가 다크면 다크 팔레트를 인라인으로 쓴다", () => {
    installMatchMedia(true);
    render(<Host />);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(varOf(ACCENT)).toBe(DARK[ACCENT]);
  });

  it("OS 가 라이트면 라이트 팔레트를 인라인으로 쓴다", () => {
    installMatchMedia(false);
    render(<Host />);

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(varOf(ACCENT)).toBe(LIGHT[ACCENT]);
  });

  it("change 가 오면 반대 모드를 다시 쓰고, 앞 모드의 변수는 남지 않는다", () => {
    const media = installMatchMedia(false);
    render(<Host />);
    // 출발점: 라이트가 적용되어 있고, 다크에 없는 키가 지금은 쓰여 있다.
    expect(varOf(ACCENT)).toBe(LIGHT[ACCENT]);
    expect(varOf(DROPPED)).toBe(LIGHT[DROPPED]);

    media.fire(true);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(varOf(ACCENT)).toBe(DARK[ACCENT]);
    // ‼️ 덮어쓰기로는 이 단언을 통과할 수 없다 — 다크 팔레트에 이 키가 없으므로,
    // 값이 비어 있다는 것은 clearThemeVars 가 먼저 돌았다는 뜻이다. 앞 모드의
    // 잔여 변수가 새 모드를 계속 덮는 것이 #330 의 결함 형태였다.
    expect(varOf(DROPPED)).toBe("");
  });

  it("편집기가 떠 있는 동안에는 OS 전환이 미리보기를 지우지 않는다", () => {
    // 위 테스트의 반대 방향. apply() 의 첫 줄이 clearThemeVars 이므로, 리스너가
    // 그대로 돌면 색을 드래그하던 미리보기가 지워지고 저장된 테마가 다시 깔린다 —
    // ThemeEditor 의 preview effect 는 deps 가 [colors, base] 라 되돌리지 못하고,
    // data-theme 까지 저장된 테마의 모드로 돌아가 혼합 미리보기가 된다.
    const media = installMatchMedia(false);
    render(
      <>
        <Host />
        <ThemeEditor onClose={() => {}} />
      </>,
    );
    const label = screen.getByText(ACCENT_LABEL, {
      selector: ".theme-editor-label",
    });
    const input = label
      .closest(".theme-editor-row")!
      .querySelector<HTMLInputElement>('input[type="color"]')!;
    fireEvent.change(input, { target: { value: SENTINEL } });
    expect(varOf(ACCENT)).toBe(SENTINEL);

    media.fire(true);

    // 편집 중인 색과 편집 중인 모드가 둘 다 그대로다.
    expect(varOf(ACCENT)).toBe(SENTINEL);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("언마운트하면 리스너를 떼어 둔다", () => {
    const media = installMatchMedia(false);
    const { unmount } = render(<Host />);
    expect(media.listenerCount()).toBe(1);

    unmount();
    expect(media.listenerCount()).toBe(0);
  });
});
