// §370.3 테마는 초기 크롬 가시성을 **제안**한다 — 강제하지 않는다.
//
// 이 파일이 지키는 것은 구분 하나다: 테마의 값은 사용자가 이번 세션에 **아직 고르지
// 않은** 표면에만 닿는다. 그 구분을 아는 것이 `chromeTouched` 이고, 어느 입구가 거기
// 기록하는가가 곧 이 기능의 정확성이다 — 너무 많이 기록하면 어떤 테마도 영영 제안하지
// 못하고, 너무 적게 기록하면 사용자가 고른 것이 지워진다. 그래서 크롬을 쓰는 입구를
// 전부 센다: 토글 셋 · `revealAllChrome` · 프리셋(`setChromeVisibility`) · 제안 자신.
//
// 코퍼스는 `useUIStore` 가 크롬 세 필드에 쓰는 입구 전부다(`stores/ui/ui.ts` 전수).
// 제안을 이펙트가 **언제** 부르는가는 여기가 아니라
// `hooks/__tests__/use-settings-effects-theme-chrome.test.tsx` 의 질문이다.
import type { InstalledTheme } from "../../../themes/theme-install";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateThemeManifest } from "../../../themes/theme-manifest";
import { useWorkspaceStore } from "../../file/workspace";
import { useSettingsStore } from "../../settings/store";
import { applyThemeChrome } from "../chrome-proposal";
import { useUIStore } from "../ui";

const REF = "baram-hangul";

/** 레퍼런스 매니페스트를 **실제 관문에 통과시켜** 얻는다 — 손으로 적은 픽스처를 쓰면
 *  `chrome` 이 조용히 버려지는 결함이 이 파일에서 무증상이 된다(버리기가 검증의 태도라
 *  그렇다, `theme-manifest.ts` 의 `validateChrome`). */
const REF_MANIFEST = (() => {
  const raw = JSON.parse(
    readFileSync(
      resolve(__dirname, "../../../themes/reference/baram-theme.json"),
      "utf8",
    ),
  ) as unknown;
  const result = validateThemeManifest(raw);
  if (!result.valid) throw new Error("reference manifest is invalid");
  return result.manifest;
})();

/** 설치 기록 한 줄. `modes` 는 비워 둔다 — 이 파일이 묻는 것은 색이 아니라 크롬이다. */
function installed(manifest: InstalledTheme["manifest"]): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: manifest.version,
    id: manifest.id,
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: `/tmp/themes/${manifest.id}`,
    manifest,
    modes: {},
  };
}

/** `chrome` 을 싣지 않은 설치 테마 — 넷째 케이스의 짝이다. */
const NO_CHROME_MANIFEST: InstalledTheme["manifest"] = {
  author: "a",
  description: "d",
  engines: { baram: ">=0.7.4" },
  id: "plain-theme",
  license: "MIT",
  modes: { light: { tokens: "light/tokens.json" } },
  name: "Plain",
  version: "1.0.0",
};

beforeEach(() => {
  useSettingsStore.setState({
    installedThemes: {
      [REF]: installed(REF_MANIFEST),
      "plain-theme": installed(NO_CHROME_MANIFEST),
    },
  });
  useUIStore.setState({
    activityBarVisible: true,
    chromeTouched: {},
    statusBarVisible: true,
    tabBarVisible: true,
  });
  useWorkspaceStore.setState({ activePresetId: null, customPresets: [] });
});

afterEach(() => {
  useSettingsStore.setState({ installedThemes: {} });
  useUIStore.setState({ chromeTouched: {} });
});

describe("§370.3 테마의 크롬 제안", () => {
  it("사용자가 손대지 않은 표면에는 테마의 제안이 적용된다", () => {
    applyThemeChrome(REF);
    const s = useUIStore.getState();
    expect(s.statusBarVisible).toBe(false);
    expect(s.activityBarVisible).toBe(false);
    expect(s.tabBarVisible).toBe(false);
  });

  // 무엇이 이것을 실패시키는가: 제안을 무조건 적용하면 사용자의 선택이 사라진다.
  it("사용자가 이미 토글한 표면은 테마가 덮지 않는다", () => {
    useUIStore.getState().toggleStatusBar(); // 껐다가
    useUIStore.getState().toggleStatusBar(); // 다시 켰다 — 명시적 선택이다
    expect(useUIStore.getState().chromeTouched.statusBar).toBe(true);

    applyThemeChrome(REF);

    expect(useUIStore.getState().statusBarVisible).toBe(true);
    // 비공허성: 손대지 않은 나머지 둘에는 그대로 닿는다 — 그러지 않으면 이 케이스는
    // "제안이 아무 데도 안 닿는다" 는 구현으로도 통과한다.
    expect(useUIStore.getState().activityBarVisible).toBe(false);
    expect(useUIStore.getState().tabBarVisible).toBe(false);
  });

  it("토글은 자기 표면만 손댄 것으로 센다", () => {
    useUIStore.getState().toggleTabBar();
    expect(useUIStore.getState().chromeTouched).toEqual({ tabBar: true });
  });

  // 무엇이 이것을 실패시키는가: 프리셋 적용을 "손댐" 으로 세면, 화면구성을 한 번 고른
  // 사용자에게 테마 제안이 영영 닿지 않는다.
  it("프리셋 적용은 손댐으로 세지 않는다", () => {
    useWorkspaceStore.getState().applyPreset("writing");
    expect(useUIStore.getState().chromeTouched).toEqual({});
    // 그 뒤에도 제안이 닿는다는 것이 이 규칙의 목적이다. `writing` 은 셋을 전부
    // 보이게 하므로(`stores/file/workspace.ts` 의 내장 프리셋), 제안이 닿으면 감춰진다.
    applyThemeChrome(REF);
    expect(useUIStore.getState().statusBarVisible).toBe(false);
  });

  // 무엇이 이것을 실패시키는가: 되살린 직후 테마가 다시 감추면, 그것이 §370.3 이
  // 금지한 강제다.
  it("revealAllChrome 은 세 표면을 모두 손댄 것으로 센다", () => {
    useUIStore.setState({
      activityBarVisible: false,
      statusBarVisible: false,
      tabBarVisible: false,
    });

    useUIStore.getState().revealAllChrome();

    expect(useUIStore.getState().chromeTouched).toEqual({
      activityBar: true,
      statusBar: true,
      tabBar: true,
    });
    applyThemeChrome(REF);
    const s = useUIStore.getState();
    expect(s.activityBarVisible).toBe(true);
    expect(s.statusBarVisible).toBe(true);
    expect(s.tabBarVisible).toBe(true);
  });

  // 무엇이 이것을 실패시키는가: 제안이 스스로를 손댐으로 세면 두 번째 테마가 영영
  // 제안할 수 없다.
  it("제안 적용 자체는 손댐으로 세지 않는다", () => {
    applyThemeChrome(REF);
    expect(useUIStore.getState().chromeTouched).toEqual({});
  });

  // 비공허성: 위 케이스들은 `applyThemeChrome` 이 아무것도 안 해도 몇은 통과한다.
  // 이 둘이 그 구현을 배제한다 — `chrome` 을 선언하지 않은 테마는 아무것도 바꾸지
  // 않고, 선언한 테마는 바꾼다.
  it("chrome 을 선언하지 않은 설치 테마는 아무 표면도 건드리지 않는다", () => {
    applyThemeChrome("plain-theme");
    const s = useUIStore.getState();
    expect(s.activityBarVisible).toBe(true);
    expect(s.statusBarVisible).toBe(true);
    expect(s.tabBarVisible).toBe(true);
  });

  it("매니페스트가 아예 없는 테마 id 는 아무 표면도 건드리지 않는다", () => {
    // 내장 테마가 이쪽이다 — 설치 기록이 없으므로 읽을 매니페스트도 없다.
    applyThemeChrome("default-dark");
    const s = useUIStore.getState();
    expect(s.activityBarVisible).toBe(true);
    expect(s.statusBarVisible).toBe(true);
    expect(s.tabBarVisible).toBe(true);
  });

  it("선언한 표면만 옮긴다", () => {
    useSettingsStore.setState({
      installedThemes: {
        partial: installed({
          ...NO_CHROME_MANIFEST,
          chrome: { statusBar: false },
          id: "partial",
        }),
      },
    });

    applyThemeChrome("partial");

    const s = useUIStore.getState();
    expect(s.statusBarVisible).toBe(false);
    expect(s.activityBarVisible).toBe(true);
    expect(s.tabBarVisible).toBe(true);
  });

  // CLAUDE.md 의 동등성 관문 — partial 은 새 root 가 되어 모든 리스너를 깨운다.
  it("바꿀 것이 없으면 스토어에 쓰지 않는다", () => {
    applyThemeChrome(REF); // 한 번 적용해 셋을 제안값에 맞춰 둔다
    let writes = 0;
    const unsubscribe = useUIStore.subscribe(() => {
      writes++;
    });

    applyThemeChrome(REF);

    unsubscribe();
    expect(writes).toBe(0);
  });
});
