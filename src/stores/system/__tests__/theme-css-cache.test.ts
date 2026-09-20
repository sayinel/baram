// §361 — the in-memory cache `use-theme-css-hydration.ts` fills and
// `use-settings-effects.ts` reads. Not persisted; see the store's own doc comment for why.
import { beforeEach, describe, expect, it } from "vitest";

import { useThemeCssCacheStore } from "../theme-css-cache";

beforeEach(() => {
  useThemeCssCacheStore.setState({ entries: {} });
});

describe("useThemeCssCacheStore", () => {
  it("starts empty", () => {
    expect(useThemeCssCacheStore.getState().entries).toEqual({});
  });

  it("stores a value under its key", () => {
    useThemeCssCacheStore.getState().setCss("dracula:dark", "body{color:red}");
    expect(useThemeCssCacheStore.getState().entries["dracula:dark"]).toBe(
      "body{color:red}",
    );
  });

  it("keeps other keys when adding a new one", () => {
    useThemeCssCacheStore.getState().setCss("a:dark", "1");
    useThemeCssCacheStore.getState().setCss("b:light", "2");
    expect(useThemeCssCacheStore.getState().entries).toEqual({
      "a:dark": "1",
      "b:light": "2",
    });
  });

  // The equality gate: a write with the SAME value must not create a new `entries` object,
  // or every hydration re-check (`use-theme-css-hydration.ts` re-runs on several unrelated
  // deps) would wake every subscriber for nothing.
  it("does not replace entries when the value is unchanged (equality gate)", () => {
    useThemeCssCacheStore.getState().setCss("a:dark", "1");
    const before = useThemeCssCacheStore.getState().entries;
    useThemeCssCacheStore.getState().setCss("a:dark", "1");
    expect(useThemeCssCacheStore.getState().entries).toBe(before);
  });

  it("does replace entries when the value actually changes", () => {
    useThemeCssCacheStore.getState().setCss("a:dark", "1");
    const before = useThemeCssCacheStore.getState().entries;
    useThemeCssCacheStore.getState().setCss("a:dark", "2");
    expect(useThemeCssCacheStore.getState().entries).not.toBe(before);
    expect(useThemeCssCacheStore.getState().entries["a:dark"]).toBe("2");
  });
});

// §361 Task 6 — `clearTheme` is what makes an update and an uninstall visible: the
// hydration hook will not re-read a key it already has, so a stale entry keeps being
// applied over bytes that have already been replaced on disk.
describe("useThemeCssCacheStore.clearTheme", () => {
  it("drops every mode of the named theme", () => {
    useThemeCssCacheStore.getState().setCss("dracula:dark", "1");
    useThemeCssCacheStore.getState().setCss("dracula:light", "2");
    useThemeCssCacheStore.getState().clearTheme("dracula");
    expect(useThemeCssCacheStore.getState().entries).toEqual({});
  });

  it("keeps a theme whose id merely starts with the same characters", () => {
    // The separator is load-bearing: a `startsWith(themeId)` without the `:` would take
    // `dracula-pro` down with `dracula`, which reads as "the other theme lost its CSS for
    // no reason" long after the uninstall that caused it.
    useThemeCssCacheStore.getState().setCss("dracula:dark", "1");
    useThemeCssCacheStore.getState().setCss("dracula-pro:dark", "2");
    useThemeCssCacheStore.getState().clearTheme("dracula");
    expect(useThemeCssCacheStore.getState().entries).toEqual({
      "dracula-pro:dark": "2",
    });
  });

  it("does not replace entries when the theme has nothing cached (equality gate)", () => {
    useThemeCssCacheStore.getState().setCss("a:dark", "1");
    const before = useThemeCssCacheStore.getState().entries;
    useThemeCssCacheStore.getState().clearTheme("nothing-cached");
    expect(useThemeCssCacheStore.getState().entries).toBe(before);
  });
});
