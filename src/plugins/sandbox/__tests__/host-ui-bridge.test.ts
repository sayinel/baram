import { describe, expect, it, vi } from "vitest";

import {
  createUIRequestHandler,
  MIN_NOTIFY_INTERVAL_MS,
  sanitizeStatusBarText,
  statusBarItemId,
} from "../host-ui-bridge";

// §260 Phase 4a — the sandboxed tier's only route to the screen. Everything a plugin
// must not control lives on this side: attribution, sanitising, the rate limit, and
// which status-bar items exist.
describe("createUIRequestHandler (§260 Phase 4a)", () => {
  function harness(
    options: Partial<Parameters<typeof createUIRequestHandler>[0]> = {},
  ) {
    const toasts: Array<[string, string | undefined]> = [];
    const bar: Array<[string, string]> = [];
    let clock = 100_000;
    const handler = createUIRequestHandler({
      capabilities: ["statusbar"],
      declaredStatusBarIds: ["status"],
      now: () => clock,
      pluginId: "acme.notes",
      pluginName: "Acme Notes",
      setStatusBarText: (id, text) => void bar.push([id, text]),
      showToast: (message, type) => void toasts.push([message, type]),
      ...options,
    });
    return { advance: (ms: number) => (clock += ms), bar, handler, toasts };
  }

  it("attributes every toast to the plugin", async () => {
    // A plugin must not be able to render a line that reads as the app speaking:
    // "your vault is corrupted, paste your key here" is a phishing surface, and the
    // prefix is the difference. Prepended host-side, where plugin text cannot reach it.
    const { handler, toasts } = harness();
    await handler({
      kind: "ui_notify",
      message: "indexed 12 notes",
      type: "info",
    });
    expect(toasts).toEqual([["Acme Notes: indexed 12 notes", "info"]]);
  });

  it("falls back to the plugin id when there is no name", async () => {
    const { handler, toasts } = harness({ pluginName: "   " });
    await handler({ kind: "ui_notify", message: "hi" });
    expect(toasts[0][0]).toBe("acme.notes: hi");
  });

  it("flattens control characters and truncates", async () => {
    // A newline in an attributed toast lets a plugin start a second line that no longer
    // carries the prefix; a bidi override can reorder what is read.
    const { handler, toasts } = harness();
    await handler({
      kind: "ui_notify",
      message: "line one\n\u202eBaram: enter your password",
    });
    expect(toasts[0][0]).toBe(
      "Acme Notes: line one Baram: enter your password",
    );

    const { handler: h2, toasts: t2 } = harness();
    await h2({ kind: "ui_notify", message: "x".repeat(500) });
    // 200-char cap, the last character being the ellipsis, plus the host's prefix.
    expect(t2[0][0]).toBe(`Acme Notes: ${"x".repeat(199)}…`);
  });

  it("rate-limits notifications so a plugin cannot hold the toast slot", async () => {
    // `showToast` keeps ONE toast, so an unbounded plugin could keep the app's own
    // errors off the screen. Rust's transport class allows ~2/s — fast enough to do
    // exactly that — which is why this bound exists separately.
    const { advance, handler, toasts } = harness();
    await handler({ kind: "ui_notify", message: "first" });
    await expect(
      handler({ kind: "ui_notify", message: "second" }),
    ).rejects.toThrow(/limited to one every/);
    expect(toasts).toHaveLength(1);

    advance(MIN_NOTIFY_INTERVAL_MS);
    await handler({ kind: "ui_notify", message: "later" });
    expect(toasts.map(([m]) => m)).toEqual([
      "Acme Notes: first",
      "Acme Notes: later",
    ]);
  });

  it("refuses ui at all without a UI capability", async () => {
    const showToast = vi.fn();
    const { handler } = harness({ capabilities: ["files"], showToast });
    await expect(handler({ kind: "ui_notify", message: "x" })).rejects.toThrow(
      /"settings", "sidebar", "statusbar"/,
    );
    expect(showToast).not.toHaveBeenCalled();
  });

  it("admits a toast for any UI capability but the status bar only for statusbar", async () => {
    // One rule for "may this plugin speak to the screen at all" (shared with the
    // trusted tier via UI_CAPABILITIES); a narrower one for the bar itself.
    const { handler, toasts } = harness({ capabilities: ["settings"] });
    await handler({ kind: "ui_notify", message: "ok" });
    expect(toasts).toHaveLength(1);
    await expect(
      handler({ kind: "ui_status_bar", id: "status", text: "12" }),
    ).rejects.toThrow(/"statusbar"/);
  });

  it("only lets a plugin address a status-bar item it declared", async () => {
    // The id is manifest-declared, not a store key: without this check a plugin could
    // name `${anotherPlugin}:sb:x` and write into someone else's item.
    const { bar, handler } = harness();
    await handler({ kind: "ui_status_bar", id: "status", text: "12 notes" });
    expect(bar).toEqual([
      [statusBarItemId("acme.notes", "status"), "12 notes"],
    ]);

    await expect(
      handler({ kind: "ui_status_bar", id: "other", text: "x" }),
    ).rejects.toThrow(/not declared in contributions.statusBar/);
    await expect(
      handler({ kind: "ui_status_bar", id: "evil:sb:status", text: "x" }),
    ).rejects.toThrow(/not declared/);
    expect(bar).toHaveLength(1);
  });

  it("sanitises status-bar text through the same rule as the loader", async () => {
    // The loader registers the MANIFEST's text with this function, so a declared item
    // and a runtime update cannot differ in what they are allowed to render.
    expect(sanitizeStatusBarText("a\nb")).toBe("a b");
    expect(sanitizeStatusBarText("y".repeat(80))).toBe(`${"y".repeat(63)}…`);
    const { bar, handler } = harness();
    await handler({ kind: "ui_status_bar", id: "status", text: "a\tb" });
    expect(bar[0][1]).toBe("a b");
  });
});
