import { describe, expect, it } from "vitest";

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
