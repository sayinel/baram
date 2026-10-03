// §386 모드 설정(스펙 0064 D1 · D9) — 기본값 · 저장 · 옛 저장본 · 동등성 관문.
import { afterEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "../settings/store";

afterEach(() => {
  useSettingsStore.setState({ colorModeSetting: "system" });
});

describe("colorModeSetting (§386)", () => {
  it("기본값은 시스템이다 — 오늘 동작과 같아 마이그레이션이 없다", () => {
    expect(useSettingsStore.getInitialState().colorModeSetting).toBe("system");
  });

  // 무엇이 이것을 실패시키는가: `store.ts` 의 `partialize`(whitelist)에서 키를 빼면 재시작마다
  // 시스템으로 돌아간다(스펙 D9).
  it("is persisted — partialize is a whitelist", () => {
    useSettingsStore.getState().setColorModeSetting("dark");
    const partialize = useSettingsStore.persist.getOptions().partialize;
    if (!partialize) throw new Error("settings store has no partialize");
    expect(partialize(useSettingsStore.getState())).toHaveProperty(
      "colorModeSetting",
      "dark",
    );
  });

  it("reads an older stored state without the key as system", () => {
    // persist 의 기본 merge 는 얕은 병합이다 — 저장본에 없는 키는 초기값으로 남는다
    // (`chrome-decline.test.ts` 와 같은 모양).
    const merged = useSettingsStore.persist
      .getOptions()
      .merge?.(
        { activeThemeId: "system" },
        useSettingsStore.getInitialState(),
      ) as undefined | { colorModeSetting?: unknown };
    expect(merged?.colorModeSetting).toBe("system");
  });

  // 무엇이 이것을 실패시키는가: setter 가 같은 값에도 `{ colorModeSetting }` 을 돌려주면 새 root 가
  // 되어 리스너를 전부 깨운다(CLAUDE.md 의 동등성 관문). zustand 는 `Object.is(next, state)` 면
  // 알리지 않는다.
  it("같은 값을 다시 쓰면 아무도 깨우지 않는다", () => {
    useSettingsStore.getState().setColorModeSetting("dark");
    let notified = 0;
    const unsubscribe = useSettingsStore.subscribe(() => {
      notified += 1;
    });
    useSettingsStore.getState().setColorModeSetting("dark");
    unsubscribe();
    expect(notified).toBe(0);
  });
});
