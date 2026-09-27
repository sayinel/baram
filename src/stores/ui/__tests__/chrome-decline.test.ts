// 스펙 0063 §3 — 테마의 크롬 제안을 사용자가 거절한 기록.
//
// 이 파일이 지키는 것은 셋이다: (1) 기록은 사용자의 조작(토글 셋 · `revealAllChrome`)만 남기고,
// (2) 기록은 제안을 건너뛰게 할 뿐 표면을 숨기지 못하며, (3) 기록은 설정 스토어에 있어 재시작
// (새 `useUIStore` 상태)을 넘는다. 리스너를 거는 이펙트는
// `hooks/__tests__/use-settings-effects-theme-chrome.test.tsx` 가 본다 — 여기서는 테스트가 직접 건다.
import type { InstalledTheme } from "../../../themes/theme-install";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../../settings/store";
import { applyThemeChrome, recordChromeChoice } from "../chrome-proposal";
import { setUserChromeChoiceListener, useUIStore } from "../ui";

const HIDER = "hider";
const SHOWER = "shower";

function installed(
  id: string,
  chrome: InstalledTheme["manifest"]["chrome"],
): InstalledTheme {
  return {
    checksum: "c".repeat(64),
    consentedAt: "2026-09-01T00:00:00.000Z",
    consentedVersion: "1.0.0",
    id,
    installedAt: "2026-09-01T00:00:00.000Z",
    installPath: `/tmp/themes/${id}`,
    manifest: {
      author: "a",
      chrome,
      description: "d",
      engines: { baram: ">=0.7.4" },
      id,
      license: "MIT",
      modes: { light: { tokens: "light/tokens.json" } },
      name: id,
      version: "1.0.0",
    },
    modes: {},
  };
}

/** 앱 시작 때의 UI 상태 — `ui.ts` 의 초기값(셋 다 보임, 손댄 표면 없음). */
function freshSession(): void {
  useUIStore.setState({
    activityBarVisible: true,
    chromeTouched: {},
    statusBarVisible: true,
    tabBarVisible: true,
  });
}

beforeEach(() => {
  useSettingsStore.setState({
    declinedChromeProposals: {},
    installedThemes: {
      [HIDER]: installed(HIDER, { statusBar: false, tabBar: false }),
      [SHOWER]: installed(SHOWER, { tabBar: true }),
    },
  });
  freshSession();
  setUserChromeChoiceListener((surfaces) =>
    recordChromeChoice(HIDER, surfaces),
  );
});

afterEach(() => {
  setUserChromeChoiceListener(null);
});

describe("recording a declined proposal", () => {
  it("records the surface the user turned back on, and only that one", () => {
    applyThemeChrome(HIDER);
    expect(useUIStore.getState().tabBarVisible).toBe(false);

    useUIStore.getState().toggleTabBar();

    expect(useSettingsStore.getState().declinedChromeProposals).toEqual({
      [HIDER]: { tabBar: true },
    });
  });

  it("forgets the decline when the user's choice comes back to the proposal", () => {
    applyThemeChrome(HIDER);
    useUIStore.getState().toggleTabBar(); // on — declined
    useUIStore.getState().toggleTabBar(); // off again — agrees with the theme

    expect(useSettingsStore.getState().declinedChromeProposals).toEqual({});
  });

  it("records every proposed surface revealAllChrome turns on", () => {
    applyThemeChrome(HIDER);

    useUIStore.getState().revealAllChrome();

    // activityBar 는 이 테마가 제안하지 않으므로 기록할 것이 없다.
    expect(useSettingsStore.getState().declinedChromeProposals).toEqual({
      [HIDER]: { statusBar: true, tabBar: true },
    });
  });

  it("does not record a preset, nor the proposal itself", () => {
    applyThemeChrome(HIDER);
    useUIStore.getState().setChromeVisibility({
      activityBarVisible: true,
      statusBarVisible: true,
      tabBarVisible: true,
    });

    expect(useSettingsStore.getState().declinedChromeProposals).toEqual({});
  });

  it("records nothing for a theme that proposes no chrome", () => {
    setUserChromeChoiceListener((surfaces) =>
      recordChromeChoice("not-installed", surfaces),
    );

    useUIStore.getState().toggleTabBar();

    expect(useSettingsStore.getState().declinedChromeProposals).toEqual({});
  });
});

describe("applying a proposal after a restart", () => {
  it("skips a declined surface in a fresh session", () => {
    applyThemeChrome(HIDER);
    useUIStore.getState().toggleTabBar(); // declined

    freshSession(); // restart: live visibility and chromeTouched are session state
    applyThemeChrome(HIDER);

    const ui = useUIStore.getState();
    expect(ui.tabBarVisible).toBe(true); // declined — skipped
    expect(ui.statusBarVisible).toBe(false); // not declined — applied
  });

  it("cannot hide a surface: a decline only skips the proposal", () => {
    // SHOWER proposes the tab bar VISIBLE. Declining it and restarting leaves the default.
    setUserChromeChoiceListener((surfaces) =>
      recordChromeChoice(SHOWER, surfaces),
    );
    useUIStore.getState().toggleTabBar(); // off — differs from SHOWER's `true`
    expect(useSettingsStore.getState().declinedChromeProposals).toEqual({
      [SHOWER]: { tabBar: true },
    });

    freshSession();
    applyThemeChrome(SHOWER);

    expect(useUIStore.getState().tabBarVisible).toBe(true);
  });
});

describe("clearing", () => {
  it("clears only the chosen theme's record", () => {
    useSettingsStore.setState({
      declinedChromeProposals: {
        [HIDER]: { tabBar: true },
        [SHOWER]: { tabBar: true },
      },
    });

    useSettingsStore.getState().clearChromeProposalDeclines(HIDER);

    expect(useSettingsStore.getState().declinedChromeProposals).toEqual({
      [SHOWER]: { tabBar: true },
    });
  });

  it("drops the record when the theme is removed", () => {
    useSettingsStore.setState({
      declinedChromeProposals: { [HIDER]: { tabBar: true } },
    });

    useSettingsStore.getState().removeInstalledTheme(HIDER);

    expect(useSettingsStore.getState().declinedChromeProposals).toEqual({});
  });

  it("writes nothing when there is nothing to change", () => {
    let writes = 0;
    const unsubscribe = useSettingsStore.subscribe(() => {
      writes += 1;
    });
    useSettingsStore.getState().clearChromeProposalDeclines(HIDER);
    useSettingsStore
      .getState()
      .setChromeProposalDeclined(HIDER, "tabBar", false);
    unsubscribe();

    expect(writes).toBe(0);
  });
});

describe("persistence", () => {
  it("is part of the persisted (partialize) shape", () => {
    useSettingsStore.setState({
      declinedChromeProposals: { [HIDER]: { tabBar: true } },
    });
    const partialize = useSettingsStore.persist.getOptions().partialize as
      ((state: unknown) => { declinedChromeProposals?: unknown }) | undefined;

    expect(
      partialize?.(useSettingsStore.getState())?.declinedChromeProposals,
    ).toEqual({
      [HIDER]: { tabBar: true },
    });
  });

  it("reads an older stored state without the key as no declines", async () => {
    // persist 의 기본 merge 는 얕은 병합이다 — 저장본에 없는 키는 초기값으로 남는다.
    // 저장된 버전과 같은 version 으로 되살려야 migrate 를 거치지 않고 merge 만 본다.
    const options = useSettingsStore.persist.getOptions();
    const merged = options.merge?.(
      { activeThemeId: "system" },
      useSettingsStore.getInitialState(),
    ) as undefined | { declinedChromeProposals?: unknown };

    expect(merged?.declinedChromeProposals).toEqual({});
  });
});
