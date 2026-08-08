// §69 — 내장 플러그인의 비활성 상태. enabled 맵이 아니라 DISABLED 목록인 것이 핵심:
// 다음 릴리스에 내장이 추가돼도 마이그레이션 없이 기본 켜짐이 된다.
import { beforeEach, describe, expect, it } from "vitest";

import { usePluginStore } from "../system/plugin";

describe("builtinDisabled (§69)", () => {
  beforeEach(() => {
    usePluginStore.setState({ builtinDisabled: [] });
  });

  it("defaults to empty, so an unknown built-in is enabled", () => {
    expect(usePluginStore.getState().builtinDisabled).toEqual([]);
  });

  it("records a disabled built-in", () => {
    usePluginStore.getState().setBuiltinEnabled("baram-media-viewer", false);
    expect(usePluginStore.getState().builtinDisabled).toEqual([
      "baram-media-viewer",
    ]);
  });

  it("removes it again when re-enabled", () => {
    usePluginStore.getState().setBuiltinEnabled("baram-media-viewer", false);
    usePluginStore.getState().setBuiltinEnabled("baram-media-viewer", true);
    expect(usePluginStore.getState().builtinDisabled).toEqual([]);
  });

  it("does not duplicate an id disabled twice", () => {
    // 같은 id가 두 번 들어가면 재활성이 한 번으로 끝나지 않는다.
    usePluginStore.getState().setBuiltinEnabled("a", false);
    usePluginStore.getState().setBuiltinEnabled("a", false);
    expect(usePluginStore.getState().builtinDisabled).toEqual(["a"]);
  });

  it("leaves other ids alone", () => {
    usePluginStore.getState().setBuiltinEnabled("a", false);
    usePluginStore.getState().setBuiltinEnabled("b", false);
    usePluginStore.getState().setBuiltinEnabled("a", true);
    expect(usePluginStore.getState().builtinDisabled).toEqual(["b"]);
  });
});

/**
 * §69 — rehydration, which is where the shape actually comes from.
 *
 * ‼️ The store's own actions can only ever produce a `string[]`, so every test above is
 * about a value this app wrote. The value the app READS comes from `config.json`, and
 * `merge` restores what storage holds — a `null` planted there (hand edit, or a consented
 * trusted plugin holding `allow-set-config`) made `loadBuiltinPlugins` throw on every
 * launch, which killed the whole plugin subsystem silently and left the repairing toggle
 * behind a marketplace that threw during render.
 *
 * Driven through the REAL `merge` rather than a copy of its logic: the defect was that
 * the value never reached a validator, so a test that validates it itself would pass with
 * the guard deleted.
 */
describe("builtinDisabled rehydration (§69)", () => {
  function rehydrate(persisted: unknown): string[] {
    const { merge } = usePluginStore.persist.getOptions();
    if (typeof merge !== "function") {
      throw new Error("persist merge is not configured");
    }
    return merge(persisted, usePluginStore.getState()).builtinDisabled;
  }

  it.each([
    ["null", null],
    ["a string", "baram-media-viewer"],
    ["a number", 7],
    ["an object", { "baram-media-viewer": true }],
    ["a boolean", false],
  ])("coerces %s to an empty list", (_label, planted) => {
    expect(rehydrate({ builtinDisabled: planted })).toEqual([]);
  });

  it("rehydrates an absent key to an empty list", () => {
    // The ordinary first launch, and the launch after a release adds the key. Uncovered
    // until now: `partialize` writes the key, so nothing else exercises its absence.
    expect(rehydrate({ installedPlugins: {} })).toEqual([]);
  });

  it("survives a persisted state that is not an object at all", () => {
    expect(rehydrate(null)).toEqual([]);
    expect(rehydrate("corrupt")).toEqual([]);
  });

  it("restores a well-formed list unchanged", () => {
    // The complement: a guard that always returned `[]` would pass every case above,
    // and would silently re-enable every built-in the user turned off.
    expect(rehydrate({ builtinDisabled: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("drops non-string members and keeps the rest", () => {
    expect(rehydrate({ builtinDisabled: ["a", null, 7, {}, "b"] })).toEqual([
      "a",
      "b",
    ]);
  });
});
