// §392 spec 0071 §6.2–§6.4 · §7.4 — the edit-mount registry: who holds a change the host has
// not taken, taking it, and a host write that replaces it.
import type { ViewerEditMount } from "../viewer-edit-mounts";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  deliverHostWrite,
  hasPendingViewerEdit,
  pendingViewerEditTabIds,
  registerViewerEditMount,
  takePendingViewerText,
  unregisterViewerEditMount,
} from "../viewer-edit-mounts";

const registered: ViewerEditMount[] = [];

function mount(over: Partial<ViewerEditMount> = {}): ViewerEditMount {
  const m: ViewerEditMount = {
    deliver: vi.fn(),
    el: document.createElement("div"),
    filePath: "/v/a.strokes",
    getText: vi.fn(() => "T1"),
    pending: false,
    pluginId: "sketch",
    tabId: "t1",
    viewerId: "sketch:pad",
    ...over,
  };
  registerViewerEditMount(m);
  registered.push(m);
  return m;
}

afterEach(() => {
  for (const m of registered.splice(0)) unregisterViewerEditMount(m);
});

describe("taking a viewer's change (§6.3)", () => {
  it("takes nothing, without calling getText, when there is no mount or no pending change", () => {
    expect(takePendingViewerText("t1")).toEqual({ kind: "none" });
    const m = mount();
    expect(takePendingViewerText("t1")).toEqual({ kind: "none" });
    expect(m.getText).not.toHaveBeenCalled();
  });

  it("takes the text once, then nothing until the next change", () => {
    const m = mount({ pending: true });
    expect(hasPendingViewerEdit("t1")).toBe(true);
    expect(takePendingViewerText("t1")).toEqual({ kind: "text", text: "T1" });
    expect(takePendingViewerText("t1")).toEqual({ kind: "none" });
    expect(m.getText).toHaveBeenCalledTimes(1);
    expect(m.getText).toHaveBeenCalledWith(m.el);
    expect(hasPendingViewerEdit("t1")).toBe(false);
  });

  it("reports a throwing getText as failed and still clears the mark (§7.4 step 1)", () => {
    const error = new Error("boom");
    mount({
      getText: () => {
        throw error;
      },
      pending: true,
    });
    expect(takePendingViewerText("t1")).toEqual({
      error,
      kind: "failed",
      viewerId: "sketch:pad",
    });
    expect(hasPendingViewerEdit("t1")).toBe(false);
  });

  it("reports a non-string as failed", () => {
    mount({ getText: () => 42 as unknown as string, pending: true });
    const pulled = takePendingViewerText("t1");
    expect(pulled.kind).toBe("failed");
    expect(hasPendingViewerEdit("t1")).toBe(false);
  });
});

describe("a host write (§6.4)", () => {
  it("drops the pending change and delivers the text once", () => {
    const m = mount({ pending: true });
    deliverHostWrite("t1", "T2");
    expect(m.deliver).toHaveBeenCalledTimes(1);
    expect(m.deliver).toHaveBeenCalledWith("T2");
    expect(hasPendingViewerEdit("t1")).toBe(false);
  });

  it("does nothing for a tab with no mount", () => {
    const m = mount({ tabId: "other" });
    deliverHostWrite("t1", "T2");
    expect(m.deliver).not.toHaveBeenCalled();
  });
});

describe("listing and lifetime", () => {
  it("lists only pending mounts that match", () => {
    mount({ pending: true, pluginId: "a", tabId: "x" });
    mount({ pending: false, pluginId: "a", tabId: "y" });
    mount({ pending: true, pluginId: "b", tabId: "z" });
    expect(pendingViewerEditTabIds((m) => m.pluginId === "a")).toEqual(["x"]);
    expect(pendingViewerEditTabIds(() => true).sort()).toEqual(["x", "z"]);
  });

  it("unregistering a stale mount leaves the newer one for the same tab", () => {
    const old = mount({ pending: false });
    const newer = mount({ pending: true });
    unregisterViewerEditMount(old);
    expect(hasPendingViewerEdit("t1")).toBe(true);
    unregisterViewerEditMount(newer);
    expect(hasPendingViewerEdit("t1")).toBe(false);
  });
});
