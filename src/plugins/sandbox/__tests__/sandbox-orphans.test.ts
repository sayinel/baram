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

    const result = await closeOrphanSandboxWebviews({
      deregister,
      listWindows,
    });

    expect(result.closed).toEqual(["alpha", "beta"]);
    expect(result.revoked).toEqual(["alpha", "beta"]);
    // The host's own windows must survive — closing `main` would close the app.
    expect(closed).toEqual(["plugin-alpha", "plugin-beta"]);
    expect(deregister.mock.calls.map(([id]) => id)).toEqual(["alpha", "beta"]);
  });

  it("leaves alone the sandboxes THIS realm owns", async () => {
    // §260 3c-3 code review (HIGH-1): the sweep sees only labels, so a live session
    // and an orphan are indistinguishable from here. Without the owned list, the
    // second call — `React.StrictMode` double-invoking the mount effect is the
    // everyday one — closes and revokes what the first call just started.
    const { closed, listWindows } = windows("plugin-mine", "plugin-orphan");
    const deregister = vi.fn(async (_id: string) => {});

    const result = await closeOrphanSandboxWebviews({
      deregister,
      listWindows,
      ownedIds: ["mine"],
    });

    expect(result.skipped).toEqual(["mine"]);
    expect(result.closed).toEqual(["orphan"]);
    expect(closed).toEqual(["plugin-orphan"]);
    expect(deregister).toHaveBeenCalledTimes(1);
    expect(deregister).toHaveBeenCalledWith("orphan");
  });

  it("revokes even when the close fails", async () => {
    // Revocation is the security-relevant half: an orphan that cannot be closed is
    // exactly the one that must not keep its capabilities (§260 3c-2a re-review N2).
    const deregister = vi.fn(async (_id: string) => {});
    const result = await closeOrphanSandboxWebviews({
      deregister,
      listWindows: async () => [
        {
          close: () => Promise.reject(new Error("window is wedged")),
          label: "plugin-alpha",
        },
      ],
    });

    expect(deregister).toHaveBeenCalledWith("alpha");
    expect(result.closed).toEqual([]); // it did NOT close…
    expect(result.revoked).toEqual(["alpha"]); // …but it is no longer authorized
  });

  it("does nothing when there is no sandbox webview", async () => {
    const deregister = vi.fn(async (_id: string) => {});
    const { closed, listWindows } = windows("main");
    const result = await closeOrphanSandboxWebviews({
      deregister,
      listWindows,
    });
    expect(result).toEqual({ closed: [], revoked: [], skipped: [] });
    expect(closed).toEqual([]);
    expect(deregister).not.toHaveBeenCalled();
  });

  it("never breaks startup when enumeration fails", async () => {
    // The sweep runs before every load; if it threw, no plugin would load at all —
    // strictly worse than the loud, recoverable label collision it exists to prevent.
    const deregister = vi.fn(async (_id: string) => {});
    const result = await closeOrphanSandboxWebviews({
      deregister,
      listWindows: () => Promise.reject(new Error("no window manager")),
    });
    expect(result).toEqual({ closed: [], revoked: [], skipped: [] });
    expect(deregister).not.toHaveBeenCalled();
  });

  it("keeps sweeping after one orphan fails to revoke", async () => {
    const deregister = vi
      .fn()
      .mockRejectedValueOnce(new Error("gone"))
      .mockResolvedValueOnce(undefined);
    const { closed, listWindows } = windows("plugin-alpha", "plugin-beta");

    const result = await closeOrphanSandboxWebviews({
      deregister,
      listWindows,
    });

    // alpha's revoke failed — it is reported as closed but NOT revoked, and beta
    // still ran. Both distinctions matter: "closed" and "revoked" fail separately.
    expect(result.closed).toEqual(["alpha", "beta"]);
    expect(result.revoked).toEqual(["beta"]);
    expect(closed).toEqual(["plugin-alpha", "plugin-beta"]);
  });
});
