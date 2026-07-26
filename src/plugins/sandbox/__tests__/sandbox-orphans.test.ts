import type { SweepableWindow } from "../sandbox-orphans";

import { describe, expect, it, vi } from "vitest";

import { closeOrphanSandboxWebviews } from "../sandbox-orphans";

// §260 Phase 3c-3 — found by the live smoke: re-adding a dev plugin failed with
// "a webview with label `plugin-baram-sandbox-smoke` already exists". A `plugin-*`
// webview is owned by Tauri, and its grant + channel are app-global, so a main-realm
// reload leaves it RUNNING and still authorized while this realm forgets it.
describe("closeOrphanSandboxWebviews (§260 3c-3)", () => {
  /** A window list with recording closers. */
  function windows(...labels: string[]) {
    const closed: string[] = [];
    const list: SweepableWindow[] = labels.map((label) => ({
      close: async () => void closed.push(label),
      label,
    }));
    return { closed, listWindows: async () => list };
  }

  it("closes and revokes only sandbox webviews", async () => {
    const { closed, listWindows } = windows(
      "main",
      "file-1",
      "plugin-alpha",
      "plugin-beta",
    );
    const deregister = vi.fn(async (_id: string) => {});

    const handled = await closeOrphanSandboxWebviews({
      deregister,
      listWindows,
    });

    expect(handled).toEqual(["alpha", "beta"]);
    // The host's own windows must survive — closing `main` would close the app.
    expect(closed).toEqual(["plugin-alpha", "plugin-beta"]);
    expect(deregister.mock.calls.map(([id]) => id)).toEqual(["alpha", "beta"]);
  });

  it("revokes even when the close fails", async () => {
    // Revocation is the security-relevant half: an orphan that cannot be closed is
    // exactly the one that must not keep its capabilities (§260 3c-2a re-review N2).
    const deregister = vi.fn(async () => {});
    const handled = await closeOrphanSandboxWebviews({
      deregister,
      listWindows: async () => [
        {
          close: () => Promise.reject(new Error("window is wedged")),
          label: "plugin-alpha",
        },
      ],
    });

    expect(deregister).toHaveBeenCalledWith("alpha");
    expect(handled).toEqual(["alpha"]);
  });

  it("does nothing when there is no sandbox webview", async () => {
    const deregister = vi.fn(async () => {});
    const { closed, listWindows } = windows("main");
    await expect(
      closeOrphanSandboxWebviews({ deregister, listWindows }),
    ).resolves.toEqual([]);
    expect(closed).toEqual([]);
    expect(deregister).not.toHaveBeenCalled();
  });

  it("never breaks startup when enumeration fails", async () => {
    // The sweep runs before every load; if it threw, no plugin would load at all —
    // strictly worse than the loud, recoverable label collision it exists to prevent.
    const deregister = vi.fn(async () => {});
    await expect(
      closeOrphanSandboxWebviews({
        deregister,
        listWindows: () => Promise.reject(new Error("no window manager")),
      }),
    ).resolves.toEqual([]);
    expect(deregister).not.toHaveBeenCalled();
  });

  it("keeps sweeping after one orphan fails to revoke", async () => {
    const deregister = vi
      .fn()
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValueOnce(undefined);
    const { closed, listWindows } = windows("plugin-alpha", "plugin-beta");

    const handled = await closeOrphanSandboxWebviews({
      deregister,
      listWindows,
    });

    // alpha's revoke failed, so it is not reported as handled — but beta still ran,
    // and both webviews were closed.
    expect(handled).toEqual(["beta"]);
    expect(closed).toEqual(["plugin-alpha", "plugin-beta"]);
  });
});
