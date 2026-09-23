import { beforeEach, describe, expect, it } from "vitest";

import { RECENT_SYMBOLS_MAX } from "../settings/editor-settings";
import { useSettingsStore } from "../settings/store";

describe("symbolSuggest setting (§375)", () => {
  it("defaults on", () => {
    expect(useSettingsStore.getInitialState().symbolSuggest).toBe(true);
  });

  it("is persisted — partialize is a whitelist", () => {
    useSettingsStore.getState().setSymbolSuggest(false);
    const partialize = useSettingsStore.persist.getOptions().partialize;
    if (!partialize) throw new Error("settings store has no partialize");
    expect(partialize(useSettingsStore.getState())).toHaveProperty(
      "symbolSuggest",
      false,
    );
    useSettingsStore.getState().setSymbolSuggest(true);
  });
});

// §377 `recentSymbols` is written on every pick from two entrances (the picker
// and the `:` menu), so it is a high-frequency path: a no-op must notify
// nobody, which only returning the SAME state object achieves (zustand skips
// listeners on `Object.is(next, state)`). Asserted as "zero notifications".
describe("recentSymbols (§377)", () => {
  beforeEach(() => {
    useSettingsStore.setState({ recentSymbols: [] });
  });

  it("defaults to empty", () => {
    expect(useSettingsStore.getInitialState().recentSymbols).toEqual([]);
  });

  it("keeps the latest first and promotes a repeat", () => {
    const { pushRecentSymbol } = useSettingsStore.getState();
    for (const c of ["→", "←", "↑", "←"]) pushRecentSymbol(c);
    expect(useSettingsStore.getState().recentSymbols).toEqual(["←", "↑", "→"]);
  });

  it(`caps the list at ${RECENT_SYMBOLS_MAX}, dropping the oldest`, () => {
    const chars = Array.from({ length: RECENT_SYMBOLS_MAX + 1 }, (_, i) =>
      String.fromCodePoint(0x2190 + i),
    );
    for (const c of chars) useSettingsStore.getState().pushRecentSymbol(c);
    const recent = useSettingsStore.getState().recentSymbols;
    expect(recent).toHaveLength(RECENT_SYMBOLS_MAX);
    expect(recent[0]).toBe(chars.at(-1));
    expect(recent).not.toContain(chars[0]);
  });

  it("notifies nobody when the character is already first", () => {
    useSettingsStore.getState().pushRecentSymbol("→");
    let notifications = 0;
    const unsubscribe = useSettingsStore.subscribe(() => {
      notifications++;
    });
    useSettingsStore.getState().pushRecentSymbol("→");
    unsubscribe();
    expect(notifications).toBe(0);
  });

  it("notifies nobody for an empty string", () => {
    let notifications = 0;
    const unsubscribe = useSettingsStore.subscribe(() => {
      notifications++;
    });
    useSettingsStore.getState().pushRecentSymbol("");
    unsubscribe();
    expect(notifications).toBe(0);
    expect(useSettingsStore.getState().recentSymbols).toEqual([]);
  });

  it("is persisted — partialize is a whitelist", () => {
    useSettingsStore.getState().pushRecentSymbol("→");
    const partialize = useSettingsStore.persist.getOptions().partialize;
    if (!partialize) throw new Error("settings store has no partialize");
    expect(partialize(useSettingsStore.getState())).toHaveProperty(
      "recentSymbols",
      ["→"],
    );
  });
});
