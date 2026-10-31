// §395 spec 0074 §5.3 · D7 · D14 · §6 · §7 "sandbox 요청" — the host side of the sandboxed file tree calls:
// the `filetree` gate with the trusted sentence, paths resolved against a context when the request
// arrives, and the in-flight backstop.
import type { PluginCapability } from "../../types";
import type { SandboxToHost } from "../protocol";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useContextStore } from "../../../stores/context/context";
import { __resetDecorationHost } from "../../file-decorations/decoration-host";
import { useFileDecorationStore } from "../../file-decorations/file-decoration-store";
import {
  DECORATION_BURST,
  DECORATION_INTERVAL_MS,
} from "../../file-decorations/limits";
import {
  fileTreeCapabilityMessage,
  NO_ACTIVE_CONTEXT_MESSAGE,
  RELATIVE_PATH_MESSAGE,
  UNKNOWN_CONTEXT_MESSAGE,
} from "../../file-decorations/validate";
import { createFileTreeRequestHandler } from "../host-file-tree-bridge";
import { INFLIGHT_BUDGET, SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

const keys = () => [...useFileDecorationStore.getState().merged.keys()];

function handler(capabilities: readonly PluginCapability[] = ["filetree"]) {
  return createFileTreeRequestHandler({
    capabilities,
    pluginId: "sb",
    pluginName: "SB",
  });
}

const set = (h: ReturnType<typeof handler>, path: string, context?: string) =>
  h({
    kind: "filetree_set_decorations",
    updates: [
      context === undefined
        ? { decoration: { badge: "1" }, path }
        : { context, decoration: { badge: "1" }, path },
    ],
  });

beforeEach(() => {
  useContextStore.setState({
    activeContextId: "ctx-v",
    contexts: [
      { contextType: "vault", id: "ctx-v", path: "/v" },
      { contextType: "vault", id: "ctx-w", path: "/w/" },
      { contextType: "file", id: "ctx-f", path: "/elsewhere/one.md" },
    ] as never,
  });
});
afterEach(() => {
  __resetDecorationHost();
  vi.useRealTimers();
});

describe("filetree host requests — paths (D7)", () => {
  it("resolves a path without context against the context the app shows", async () => {
    await set(handler(), "notes/a.md");
    expect(keys()).toEqual(["/v/notes/a.md"]);
  });

  it("resolves a path against the context it names", async () => {
    await set(handler(), "a.md", "ctx-w");
    expect(keys()).toEqual(["/w/a.md"]);
  });

  it("takes a file context's empty path as the file itself, and refuses another path there", async () => {
    await set(handler(), "", "ctx-f");
    expect(keys()).toEqual(["/elsewhere/one.md"]);
    await expect(set(handler(), "x.md", "ctx-f")).rejects.toThrow(
      UNKNOWN_CONTEXT_MESSAGE,
    );
  });

  /** §6 — each refused whole, nothing applied. */
  it("refuses an unknown context, a missing active context and a path locateInContext never writes", async () => {
    await expect(set(handler(), "a.md", "ctx-zz")).rejects.toThrow(
      UNKNOWN_CONTEXT_MESSAGE,
    );
    await expect(set(handler(), "/v/a.md")).rejects.toThrow(
      RELATIVE_PATH_MESSAGE,
    );
    useContextStore.setState({ activeContextId: null });
    await expect(set(handler(), "a.md")).rejects.toThrow(
      NO_ACTIVE_CONTEXT_MESSAGE,
    );
    expect(keys()).toEqual([]);
  });

  /** D7 "호출을 받을 때" — a call waiting in line keeps the context active when it arrived. What fails
   *  this: reading the active context when the call is applied (the decoration would land in /w). */
  it("reads the active context when the request arrives, not when it is applied", async () => {
    vi.useFakeTimers();
    const h = handler();
    for (let i = 0; i < DECORATION_BURST; i += 1) await set(h, `n${i}.md`);
    const waiting = set(h, "late.md");
    useContextStore.setState({ activeContextId: "ctx-w" });
    await vi.advanceTimersByTimeAsync(DECORATION_INTERVAL_MS);
    await waiting;
    expect(keys()).toContain("/v/late.md");
    expect(keys()).not.toContain("/w/late.md");
  });
});

describe("filetree host requests — the gate (§6 · P24)", () => {
  /** What fails this: no gate, or the gate's "requires one of" sentence instead of the trusted tier's. */
  it.each([
    ["filetree_clear_decorations", "clearFileDecorations"],
    ["filetree_define_icon", "defineFileIcon"],
    ["filetree_set_decorations", "setFileDecorations"],
  ] as const)("refuses %s without filetree", async (kind, method) => {
    const requests = {
      filetree_clear_decorations: { kind: "filetree_clear_decorations" },
      filetree_define_icon: {
        kind: "filetree_define_icon",
        name: "a",
        svg: "<svg/>",
      },
      filetree_set_decorations: {
        kind: "filetree_set_decorations",
        updates: [],
      },
    };
    const h = handler(["sidebar"]);
    await expect(h(requests[kind] as Parameters<typeof h>[0])).rejects.toThrow(
      fileTreeCapabilityMessage(method),
    );
    expect(keys()).toEqual([]);
  });
});

describe("the in-flight backstop (D14 · §6)", () => {
  /** §7 — a sandbox that skips its client's line meets `INFLIGHT_BUDGET.filetree`: the fifth request in
   *  flight is refused, the fourth reached the handler. */
  it("refuses a fifth filetree request in flight", async () => {
    const { host, sandbox } = createChannelPair();
    const seen: unknown[] = [];
    sandbox.onMessage((m) => seen.push(m));
    const pending = vi.fn(() => new Promise(() => {}));
    new SandboxSession(host, pending);
    for (let i = 0; i <= INFLIGHT_BUDGET.filetree; i += 1) {
      sandbox.send({
        request: { kind: "filetree_clear_decorations" },
        requestId: `r${i}`,
        type: "hostRequest",
      } as SandboxToHost);
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(INFLIGHT_BUDGET.filetree).toBe(4);
    expect(pending).toHaveBeenCalledTimes(INFLIGHT_BUDGET.filetree);
    expect(seen).toEqual([
      expect.objectContaining({
        error: expect.stringContaining("too many"),
        ok: false,
        requestId: `r${INFLIGHT_BUDGET.filetree}`,
      }),
    ]);
  });
});
