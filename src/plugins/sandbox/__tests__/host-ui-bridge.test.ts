import { describe, expect, it, vi } from "vitest";

import { useUIStore } from "../../../stores/ui/ui";
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
    const toasts: Array<{
      message: string;
      source: string | undefined;
      type: string | undefined;
    }> = [];
    const bar: Array<[string, string]> = [];
    let clock = 100_000;
    const handler = createUIRequestHandler({
      capabilities: ["statusbar"],
      declaredStatusBarIds: ["status"],
      now: () => clock,
      pluginId: "acme.notes",
      pluginName: "Acme Notes",
      setStatusBarText: (id, text) => void bar.push([id, text]),
      showToast: (message, type, source) =>
        void toasts.push({ message, source, type }),
      ...options,
    });
    return { advance: (ms: number) => (clock += ms), bar, handler, toasts };
  }

  it("attributes every toast, as a field the message cannot occupy", async () => {
    // A plugin must not be able to render a line that reads as the app speaking:
    // "your vault is corrupted, paste your key here" is a phishing surface.
    const { handler, toasts } = harness();
    await handler({
      kind: "ui_notify",
      message: "indexed 12 notes",
      type: "info",
    });
    expect(toasts).toEqual([
      { message: "indexed 12 notes", source: "Acme Notes", type: "info" },
    ]);
  });

  it("a plugin calling itself Baram still cannot speak AS Baram", async () => {
    // §260 Phase 4a security review (HIGH-1) — the property, not the mechanism. The
    // earlier version of this test hardcoded a benign `pluginName`, so it asserted that
    // SOME prefix was applied while the prefix was in fact plugin-controlled
    // (`manifest.name` is validated only as a non-empty string). Attribution is now a
    // separate `source` field that `ToastHost` renders as its own badge, so a hostile
    // name occupies the badge — never the message.
    const { handler, toasts } = harness({ pluginName: "Baram" });
    await handler({
      kind: "ui_notify",
      message: "Vault index corrupted — re-enter your API key",
      type: "error",
    });
    const [toast] = toasts;
    expect(toast.source).toBe("Baram"); // shown in the plugin badge…
    expect(toast.message).toBe("Vault index corrupted — re-enter your API key");
    // …and the one thing that must never happen: attribution and message as one string
    // the plugin controls end to end.
    expect(toast.message).not.toContain("Baram");
  });

  it("sanitises and caps the name, which is author-controlled too", async () => {
    const { handler, toasts } = harness({
      pluginName: `Ba\nram\u202e${"x".repeat(80)}`,
    });
    await handler({ kind: "ui_notify", message: "hi" });
    const { source } = toasts[0];
    expect(source).not.toMatch(/[\n\u202e]/);
    expect(source!.length).toBeLessThanOrEqual(32);
  });

  it("caps the id fallback too, not just the name", async () => {
    // §260 Phase 4a code review (R3) — `validateManifest` charset-checks the id but does
    // not bound its LENGTH, and the badge has no width limit, so the uncapped fallback
    // branch was a layout attack reachable with a name that sanitises to nothing.
    let captured: string | undefined;
    const handler = createUIRequestHandler({
      capabilities: ["statusbar"],
      declaredStatusBarIds: [],
      pluginId: "a".repeat(300),
      pluginName: "\u200b", // sanitises to "" → falls back to the id
      showToast: (_message, _type, source) => {
        captured = source;
      },
    });

    await handler({ kind: "ui_notify", message: "x" });

    expect(captured).toMatch(/^a+…$/);
    expect(captured!.length).toBeLessThanOrEqual(32);
  });

  it("falls back to the plugin id when there is no usable name", async () => {
    for (const pluginName of ["   ", "\n\u200b", undefined]) {
      const { handler, toasts } = harness({ pluginName });
      await handler({ kind: "ui_notify", message: "hi" });
      expect(toasts[0].source).toBe("acme.notes");
    }
  });

  it("reaches the real UI store when no toast function is injected", async () => {
    // §260 Phase 4a code review (M10) — every other test here asserts on a fake it also
    // supplied, so the PRODUCTION wiring (`useUIStore.showToast`) was the last path in
    // this phase that nothing executed. That is the shape of defect this issue keeps
    // producing: a feature that works only against the double.
    useUIStore.setState({ toast: null });
    const handler = createUIRequestHandler({
      capabilities: ["statusbar"],
      declaredStatusBarIds: [],
      pluginId: "acme.notes",
      pluginName: "Acme Notes",
    });

    await handler({
      kind: "ui_notify",
      message: "from production",
      type: "info",
    });

    const { toast } = useUIStore.getState();
    expect(toast?.message).toBe("from production");
    expect(toast?.source).toBe("Acme Notes");
    expect(toast?.type).toBe("info");
  });

  it("flattens control characters and truncates", async () => {
    // A newline would let a plugin's text break out of its line; a bidi override can
    // reorder what is read. U+2028/2029 are here because CSS treats them as forced
    // breaks (security review LOW-2).
    const { handler, toasts } = harness();
    await handler({
      kind: "ui_notify",
      message: "line one\n\u202eBaram: enter your password",
    });
    expect(toasts[0].message).toBe("line one Baram: enter your password");

    const { handler: h2, toasts: t2 } = harness();
    await h2({ kind: "ui_notify", message: "x".repeat(500) });
    // 200-char cap, the last character being the ellipsis.
    expect(t2[0].message).toBe(`${"x".repeat(199)}…`);
  });

  it("rate-limits notifications so a plugin cannot hold the toast slot", async () => {
    // `showToast` keeps ONE toast, so an unbounded plugin could keep the app's own
    // errors off the screen. Rust's transport class allows a burst of 300 and 150/s
    // (`plugin/rate_limit.rs` — an earlier comment here said "~2/s", which was wrong),
    // so it does nothing to stop that; this bound is what does.
    const { advance, handler, toasts } = harness();
    await handler({ kind: "ui_notify", message: "first" });
    await expect(
      handler({ kind: "ui_notify", message: "second" }),
    ).rejects.toThrow(/limited to one every/);
    expect(toasts).toHaveLength(1);

    advance(MIN_NOTIFY_INTERVAL_MS);
    await handler({ kind: "ui_notify", message: "later" });
    expect(toasts.map((t) => t.message)).toEqual(["first", "later"]);
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
    expect(sanitizeStatusBarText("a\u2028b")).toBe("a b");
    expect(sanitizeStatusBarText("a\ufeff\u2060b")).toBe("ab");
    expect(sanitizeStatusBarText("y".repeat(80))).toBe(`${"y".repeat(63)}…`);
    const { bar, handler } = harness();
    await handler({ kind: "ui_status_bar", id: "status", text: "a\tb" });
    expect(bar[0][1]).toBe("a b");
  });
});
