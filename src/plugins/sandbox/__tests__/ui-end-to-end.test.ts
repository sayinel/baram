import type { SandboxContext } from "../../types";
import type { PluginOp } from "../plugin-op";

import { describe, expect, it, vi } from "vitest";

import { createHostRequestHandler } from "../host-request-router";
import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

// §260 Phase 4a — the real client against the real session, for the same reason the
// `ai` suite exists (3c-2c code review): every other suite drives one half against a
// hand-rolled peer, so a field that stops being echoed would pass everywhere and fail
// only in the live smoke. `ctx.ui` is void-returning, which makes it MORE important to
// test end to end — plugin code cannot observe a dropped frame at all.
describe("ui end-to-end: real client ↔ real session (§260 Phase 4a)", () => {
  const broker = async (op: PluginOp) =>
    op.kind === "source_read" ? "// bundle" : undefined;

  async function pair(capabilities: string[]) {
    const toasts: Array<{ message: string; source?: string }> = [];
    const bar: Array<[string, string]> = [];
    const { host, sandbox } = createChannelPair();
    let ctx: SandboxContext | undefined;
    startSandboxClient(
      sandbox,
      async () => ({
        activate: (c: SandboxContext) => {
          ctx = c;
        },
      }),
      broker,
    );
    const session = new SandboxSession(
      host,
      createHostRequestHandler({
        capabilities: capabilities as never,
        declaredSettings: [],
        declaredStatusBarIds: ["count"],
        pluginId: "p",
        pluginName: "Plugin P",
        setStatusBarText: (id, text) => void bar.push([id, text]),
        showToast: (message, _type, source) =>
          void toasts.push({ message, source }),
      }),
    );
    await session.activate("p", { commands: [] });
    if (!ctx) throw new Error("activate did not run");
    return { bar, ctx, session, toasts };
  }

  /** `ui` is fire-and-forget, so let the frame round-trip before asserting. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("carries a notification from plugin code to the host toast", async () => {
    const { ctx, toasts } = await pair(["statusbar"]);
    ctx.ui.showNotification("indexed 3 notes", "info");
    await settle();
    expect(toasts).toEqual([
      { message: "indexed 3 notes", source: "Plugin P" },
    ]);
  });

  it("carries a status-bar update to the namespaced item", async () => {
    const { bar, ctx } = await pair(["statusbar"]);
    ctx.ui.setStatusBarText("count", "3 notes");
    await settle();
    expect(bar).toEqual([["p:sb:count", "3 notes"]]);
  });

  it("swallows a refusal instead of leaving an unhandled rejection", async () => {
    // The API returns void (as the trusted tier's does), so the plugin has nothing to
    // await. A refusal must surface in the sandbox log, not as an unhandled rejection
    // that would be invisible in this realm.
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { ctx, toasts } = await pair(["files"]); // no UI capability
      expect(() => ctx.ui.showNotification("x")).not.toThrow();
      await settle();
      await settle();
      expect(toasts).toEqual([]);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("frees its in-flight slot, so ui calls do not exhaust the request budget", async () => {
    // A `ui` request settles immediately, unlike `ai`. If the slot were held, a session
    // would run out of `ui` slots (INFLIGHT_BUDGET.ui) and refuse every later toast.
    const { ctx, toasts } = await pair(["statusbar"]);
    for (let i = 0; i < 10; i++) {
      ctx.ui.setStatusBarText("count", `${i}`);
      await settle();
    }
    ctx.ui.showNotification("still working");
    await settle();
    expect(toasts).toEqual([{ message: "still working", source: "Plugin P" }]);
  });
});
