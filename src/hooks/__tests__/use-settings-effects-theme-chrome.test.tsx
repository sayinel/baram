// §370.3 테마의 크롬 제안은 **테마 id 가 바뀌는 전이에서만** 적용된다.
//
// 제안 자체의 규칙(손대지 않은 표면에만 닿는다)은 `stores/ui/__tests__/chrome-proposal.test.ts`
// 가 센다. 이 파일이 묻는 것은 하나뿐이다 — **언제 부르는가.**
//
// 그 질문이 따로 있는 이유: 테마 적용 이펙트의 deps 는 다섯이고
// (`use-settings-effects.ts` 전사: `effectiveThemeId` · `customThemes` ·
// `installedThemes` · `cssCacheEntries` · `resolvedDials`), 그래서 그 이펙트는 OS 모드
// 전환 · CSS 캐시 하이드레이션 · 다이얼 변경으로도 다시 돈다. 제안을 거기 얹으면
// 사용자가 상태바를 켠 뒤 강조색 슬라이더를 움직이는 것만으로 다시 꺼진다.
//
// ‼️ 그리고 `<StrictMode>` 가 여기 있는 이유: 전이 감지를 `useRef` 가드로 만들면
// StrictMode 의 마운트 → 정리 → 재마운트를 ref 가 살아남아, 버려지는 첫 마운트에서
// 세워진 가드가 이후 **진짜** 전이를 영영 건너뛴다(계획 0095 가 그 모양으로 사용자
// 눈에 띄는 결함을 냈다). StrictMode 없이 시험하면 그 결함이 그대로 통과한다.
//
// ‼️ **이 파일의 `act()` 콜백은 전부 블록 본문이다** — `act(() => store.doThing())`
// 처럼 간결 화살표로 적지 말 것. 이 문단은 이 파일의 모든 `act(` 호출을 지배한다.
// 실측(2026-09-23): `act(() => useSettingsStore.getState().setDial(…))` 은 persist
// 미들웨어가 반환하는 **thenable** 을 그대로 돌려주고, React 는 반환값이 thenable 이면
// async act 모드로 들어간다. 아무도 await 하지 않으므로 act 큐가 열린 채 남고, 그 뒤의
// 모든 `render()` 가 이펙트를 한 번도 돌리지 않는다 — 증상은 **다음** 테스트 셋이
// "제안이 적용되지 않는다" 로 실패하는 것이었다(가해 테스트 자신은 통과한다). 블록
// 본문은 `undefined` 를 돌려주므로 그 경로에 들어가지 않는다.
import { StrictMode } from "react";

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 세 모듈 mock 은 형제 settings-effects 스위트와 같다(같은 이유 — 이 훅은 네이티브
// 메뉴를 지연 `import()` 로 동기화하고, 그중 하나가 vitest 가 환경을 내린 뒤 착지하면
// 모든 테스트가 통과한 채로 런 전체가 실패한다).
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
vi.mock("../../themes/theme-store-fs", () => ({
  readStoredThemeCss: () => Promise.resolve(null),
}));

import type { InstalledTheme } from "../../themes/theme-install";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { useSettingsStore } from "../../stores/settings/store";
import { usePluginStore } from "../../stores/system/plugin";
import { useThemeCssCacheStore } from "../../stores/system/theme-css-cache";
import { useUIStore } from "../../stores/ui/ui";
import { validateThemeManifest } from "../../themes/theme-manifest";
import { defaultColorsForBase } from "../../types/theme";
import { useSettingsEffects } from "../use-settings-effects";

const REF = "baram-hangul";

/** 레퍼런스 매니페스트를 실제 관문에 통과시켜 얻는다 — 손으로 적은 픽스처는 `chrome`
 *  이 조용히 버려지는 결함을 이 파일에서 무증상으로 만든다. */
const REF_MANIFEST = (() => {
  const raw = JSON.parse(
    readFileSync(
      resolve(__dirname, "../../themes/reference/baram-theme.json"),
      "utf8",
    ),
  ) as unknown;
  const result = validateThemeManifest(raw);
  if (!result.valid) throw new Error("reference manifest is invalid");
  return result.manifest;
})();

/** 두 번째 테마 — 첫 테마와 **다른** id 로 전이를 만들기 위한 것. 크롬은 탭 표시줄
 *  하나만 제안한다. */
const OTHER_MANIFEST: InstalledTheme["manifest"] = {
  author: "a",
  chrome: { tabBar: false },
  description: "d",
  engines: { baram: ">=0.7.4" },
  id: "other-theme",
  license: "MIT",
  modes: { light: { tokens: "light/tokens.json" } },
  name: "Other",
  version: "1.0.0",
};

/**
 * 크롬 셋을 **프리셋이 하듯** 되살린다 — `setChromeVisibility` 는 프리셋 전용 입구이고
 * 손댐을 기록하지 **않는다**(`stores/ui/ui.ts` 의 `chromeTouched` 표;
 * `stores/file/workspace.ts` 의 `applyPreset` 이 유일한 프로덕션 호출자다).
 *
 * ‼️ 아래 세 케이스가 토글이 아니라 이 입구를 쓰는 이유가 이 파일에서 가장 중요한
 * 결정이다. 토글은 손댐을 기록하므로, 제안이 **잘못 다시 적용돼도** 그 표면은
 * 건너뛰어져 아무것도 관측되지 않는다 — 실측(2026-09-23): 제안을 deps 다섯 개짜리
 * 테마 이펙트 안으로 옮긴 구현이 토글 버전 세 케이스를 **전부 통과**했다. 프리셋으로
 * 되살린 표면은 기록이 없어 제안이 다시 닿을 수 있고, 그래서 그 구현이 빨개진다.
 *
 * 이것이 실제 사용자 경로이기도 하다: 이 테마를 입은 채 "Writing" 프리셋을 고른 뒤
 * 강조색 슬라이더를 움직이면, 잘못된 구현에서는 크롬이 도로 사라진다.
 */
function restoreChromeAsAPresetWould(): void {
  act(() => {
    useUIStore.getState().setChromeVisibility({
      activityBarVisible: true,
      statusBarVisible: true,
      tabBarVisible: true,
    });
  });
  expectChromeVisible();
}

/** 세 표면이 모두 보이는가. */
function expectChromeVisible(): void {
  const s = useUIStore.getState();
  expect(s.activityBarVisible).toBe(true);
  expect(s.statusBarVisible).toBe(true);
  expect(s.tabBarVisible).toBe(true);
}

/** 이 파일이 시험하는 훅을 마운트하기만 하는 껍데기. 에디터는 필요 없다. */
function Host() {
  useSettingsEffects(null);
  return null;
}

function installed(manifest: InstalledTheme["manifest"]): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: manifest.version,
    id: manifest.id,
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: `/tmp/themes/${manifest.id}`,
    manifest,
    modes: { light: { colors: defaultColorsForBase("light"), css: false } },
  };
}

/** OS 색 모드 전환을 실제로 쏘기 위한 리스너 장부 — 형제 스위트의 mock 은 등록을
 *  버린다. 테마 적용 이펙트가 `change` 에서 `apply()` 를 다시 도는 그 경로다. */
const schemeListeners = new Set<() => void>();
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  schemeListeners.clear();
  window.matchMedia = ((query: string) => ({
    addEventListener: (_type: string, listener: () => void) =>
      schemeListeners.add(listener),
    matches: false,
    media: query,
    removeEventListener: (_type: string, listener: () => void) =>
      schemeListeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  useThemeCssCacheStore.setState({ entries: {} });
  usePluginStore.setState({ revocations: null });
  useSettingsStore.setState({
    activeThemeId: REF,
    appearanceOverrides: {},
    customThemes: [],
    installedThemes: {
      [REF]: installed(REF_MANIFEST),
      "other-theme": installed(OTHER_MANIFEST),
    },
    locale: "en",
  });
  useUIStore.setState({
    activityBarVisible: true,
    chromeTouched: {},
    statusBarVisible: true,
    tabBarVisible: true,
  });
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  useSettingsStore.setState({
    activeThemeId: "system",
    appearanceOverrides: {},
    installedThemes: {},
  });
  useUIStore.setState({ chromeTouched: {} });
  useThemeCssCacheStore.setState({ entries: {} });
});

describe("§370.3 제안은 테마 전이에서만 적용된다", () => {
  it("StrictMode 에서 두 번 돌아도 결과는 한 번 돈 것과 같다", async () => {
    render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(useUIStore.getState().statusBarVisible).toBe(false);
    });
    const s = useUIStore.getState();
    expect(s.activityBarVisible).toBe(false);
    expect(s.tabBarVisible).toBe(false);
    // 제안은 스스로를 손댐으로 세지 않는다 — 두 번 돌아도 마찬가지다.
    expect(s.chromeTouched).toEqual({});
  });

  // ‼️ 이 케이스는 `ref` 가드를 배제하지 **못한다.** id 별 ref 든 한 번만 도는 boolean
  // ref 든, StrictMode 의 버려지는 첫 마운트가 이미 적용을 수행하므로 두 번째가
  // 건너뛰어도 결과가 같다. 그 배제는 이 파일 **마지막** 케이스가 맡는다(거기 주석).
  //
  // 무엇이 이것을 실패시키는가, 둘:
  //  ① **멱등하지 않은 제안** — `proposeChromeVisibility` 가 제안값을 쓰는 대신 현재
  //     값을 뒤집게 바꾸면 두 번째 마운트가 첫 마운트를 되돌려 빨개진다(실측
  //     2026-09-23). 같은 구현을 StrictMode 없이 한 번만 마운트하면 "감춰졌다" 는
  //     올바른 결과를 내므로, 그것을 잡는 것은 이 래퍼다.
  //  ② **deps 가 없거나 틀린 이펙트** — deps 배열을 빼면 아래 `rerender` 가 제안을 다시
  //     적용해, 프리셋이 되살린 크롬을 도로 감춘다.
  //
  // 되살리기를 토글이 아니라 프리셋 입구로 하는 이유는 `restoreChromeAsAPresetWould`
  // 의 주석에 있다. 토글 쪽 계약("사용자가 토글한 표면은 테마가 덮지 않는다")은
  // `stores/ui/__tests__/chrome-proposal.test.ts` 가 직접 센다.
  it("StrictMode 로 마운트한 뒤 재렌더가 제안을 다시 적용하지 않는다", async () => {
    const { rerender } = render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(useUIStore.getState().statusBarVisible).toBe(false);
    });

    restoreChromeAsAPresetWould();

    rerender(
      <StrictMode>
        <Host />
      </StrictMode>,
    );

    expectChromeVisible();
  });

  it("다이얼이 바뀌어도 제안이 다시 적용되지 않는다", async () => {
    render(<Host />);
    await waitFor(() => {
      expect(useUIStore.getState().statusBarVisible).toBe(false);
    });
    restoreChromeAsAPresetWould();

    // 강조색 슬라이더를 움직이는 것 — `resolvedDials` 가 움직이므로 테마 적용
    // 이펙트는 실제로 다시 돈다(deps 다섯 중 하나).
    act(() => {
      useSettingsStore.getState().setDial("accentHueShift", 20);
    });

    await waitFor(() => {
      expect(useSettingsStore.getState().appearanceOverrides).toEqual({
        accentHueShift: 20,
      });
    });
    expectChromeVisible();
  });

  it("CSS 캐시가 늦게 채워져도 제안이 다시 적용되지 않는다", async () => {
    render(<Host />);
    await waitFor(() => {
      expect(useUIStore.getState().statusBarVisible).toBe(false);
    });
    restoreChromeAsAPresetWould();

    act(() => {
      useThemeCssCacheStore.setState({
        entries: { [`${REF}:light`]: "@layer baram-theme {}\n" },
      });
    });

    expectChromeVisible();
  });

  it("OS 색 모드가 바뀌어도 제안이 다시 적용되지 않는다", async () => {
    render(<Host />);
    await waitFor(() => {
      expect(useUIStore.getState().statusBarVisible).toBe(false);
    });
    restoreChromeAsAPresetWould();
    // 비공허성: 실제로 리스너가 등록돼 있어야 이 프로브가 무언가를 쏜다.
    expect(schemeListeners.size).toBeGreaterThan(0);

    act(() => {
      schemeListeners.forEach((listener) => listener());
    });

    expectChromeVisible();
  });

  // ‼️ 이 케이스가 혼자 보는 것은 **두 번째 전이**다 — 그래서 이것이 `ref` 가드를
  // 배제하는 자리다.
  //
  // 위 넷의 비공허성 때문이 아니다: 위 넷은 각자 첫
  // `waitFor(statusBarVisible === false)` 로 "제안이 아예 적용되지 않는다" 를 이미
  // 배제한다. 배제되지 않고 남는 것은 **마운트 때 한 번 적용하고 그 뒤로는 영영
  // 적용하지 않는** 구현이다(한 번만 세우는 boolean ref·모듈 플래그 — 계획 0095 가 낸
  // 결함의 모양). 그 구현은 위 넷을 전부 통과하고, 아래 마지막 단언에서만 빨개진다.
  //
  // StrictMode 는 여기서 필요하지 않다 — 그런 가드는 한 번만 마운트해도 두 번째
  // 전이를 건너뛴다. id 별 ref 는 이 케이스도 통과하지만, 그쪽은 deps 비교와 동작이
  // 같아서 배제할 대상이 아니다(불필요할 뿐이다).
  it("테마 id 가 실제로 바뀌면 새 테마의 제안이 닿는다", async () => {
    render(<Host />);
    await waitFor(() => {
      expect(useUIStore.getState().tabBarVisible).toBe(false);
    });
    act(() => {
      useUIStore.getState().revealAllChrome();
    });
    expect(useUIStore.getState().tabBarVisible).toBe(true);

    act(() => {
      useSettingsStore.getState().setActiveTheme("other-theme");
    });

    // `revealAllChrome` 이 셋을 손댐으로 기록했으므로 새 테마의 제안도 닿지 않는다 —
    // 그것이 §370.3 의 "제안이지 강제가 아니다" 다.
    await waitFor(() => {
      expect(useSettingsStore.getState().activeThemeId).toBe("other-theme");
    });
    expect(useUIStore.getState().tabBarVisible).toBe(true);

    // 손댐 기록을 지우면 같은 전이가 닿는다 — 위 단언이 "전이가 아예 감지되지
    // 않는다" 로 통과한 것이 아님을 여기서 관측한다.
    act(() => {
      useUIStore.setState({ chromeTouched: {} });
      useSettingsStore.getState().setActiveTheme(REF);
    });
    await waitFor(() => {
      expect(useUIStore.getState().tabBarVisible).toBe(false);
    });
  });
});
