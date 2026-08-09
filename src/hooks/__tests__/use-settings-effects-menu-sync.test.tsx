// §82 follow-up — the two native-menu effects in `useSettingsEffects` load their IPC
// module with a lazy `import()`, so the `.then` runs a tick or more after the effect did.
// Before the `active` guard it ran unconditionally: it pushed a menu update after the tree
// had unmounted, and a resolution that lost a race against a dep change could overwrite a
// newer sync with stale labels.
//
// The pair below is deliberate. The mounted case establishes that ONE flush of the form
// used here is enough for the lazy import to resolve and call through; the unmounted case
// then uses the SAME flush, so "not called" cannot be an artifact of flushing too little.
// Asserting only the negative would pass just as well against an effect that never syncs
// at all.
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSettingsEffects } from "../use-settings-effects";

const mocks = vi.hoisted(() => ({
  syncMenuLocale: vi.fn(() => Promise.resolve()),
  syncRecentMenu: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../ipc/menu-locale", () => ({
  syncMenuLocale: mocks.syncMenuLocale,
}));
vi.mock("../../ipc/recent-menu", () => ({
  syncRecentMenu: mocks.syncRecentMenu,
}));

function Host() {
  useSettingsEffects(null);
  return null;
}

/// Let every pending lazy import and its `.then` settle.
async function settleLazyImports(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSettingsEffects native-menu sync (§82)", () => {
  beforeEach(() => {
    mocks.syncMenuLocale.mockClear();
    mocks.syncRecentMenu.mockClear();
  });

  it("syncs both native menus while mounted", async () => {
    render(<Host />);
    await settleLazyImports();
    expect(mocks.syncMenuLocale).toHaveBeenCalledTimes(1);
    expect(mocks.syncRecentMenu).toHaveBeenCalledTimes(1);
  });

  it("syncs neither after the tree unmounts", async () => {
    const { unmount } = render(<Host />);
    // Unmount before the flush: the effect has started its `import()` and the cleanup runs
    // while that promise is still pending, which is exactly the window the guard covers.
    unmount();
    await settleLazyImports();
    expect(mocks.syncMenuLocale).not.toHaveBeenCalled();
    expect(mocks.syncRecentMenu).not.toHaveBeenCalled();
  });
});
