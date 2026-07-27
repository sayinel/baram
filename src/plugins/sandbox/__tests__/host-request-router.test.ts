import type { AIAPI } from "../../types";

import { describe, expect, it, vi } from "vitest";

import { createHostRequestHandler } from "../host-request-router";

// §260 Phase 4a — 3c-2c's single handler put ONE capability check (`ai`) ahead of the
// switch, so adding a second service there would have made `ui` require the `ai` grant.
// These tests pin the property that split them: each service answers under its own rule.
describe("createHostRequestHandler routing (§260 Phase 4a)", () => {
  const ai: AIAPI = {
    complete: async () => "answer",
    listModels: async () => [{ id: "m", name: "M" }],
    stream: async (_p, _o, onToken) => void onToken("t"),
  };
  const noop = () => {};

  function handlerFor(
    capabilities: Parameters<
      typeof createHostRequestHandler
    >[0]["capabilities"],
  ) {
    const toasts: Array<{ message: string; source?: string }> = [];
    const handler = createHostRequestHandler({
      aiFactory: () => ai,
      capabilities,
      declaredSettings: [],
      declaredStatusBarIds: ["s"],
      pluginId: "p",
      pluginName: "P",
      showToast: (message, _type, source) =>
        void toasts.push({ message, source }),
    });
    return { handler, toasts };
  }

  it("answers a ui request for a plugin that holds no ai grant", async () => {
    const { handler, toasts } = handlerFor(["statusbar"]);
    await handler({ kind: "ui_notify", message: "hello" }, noop);
    expect(toasts).toEqual([{ message: "hello", source: "P" }]);
  });

  it("answers an ai request for a plugin that holds no ui capability", async () => {
    const { handler } = handlerFor(["ai"]);
    await expect(
      handler({ kind: "ai_complete", prompt: "x" }, noop),
    ).resolves.toBe("answer");
  });

  it("keeps each service behind its OWN gate", async () => {
    const { handler } = handlerFor(["statusbar"]);
    await expect(
      handler({ kind: "ai_complete", prompt: "x" }, noop),
    ).rejects.toThrow(/"ai" capability/);

    const { handler: aiOnly } = handlerFor(["ai"]);
    await expect(
      aiOnly({ kind: "ui_notify", message: "x" }, noop),
    ).rejects.toThrow(/settings|sidebar|statusbar/);
  });

  it("streams ai tokens through the router unchanged", async () => {
    const { handler } = handlerFor(["ai"]);
    const tokens: string[] = [];
    await handler({ kind: "ai_stream", prompt: "x" }, (t) => tokens.push(t));
    expect(tokens).toEqual(["t"]);
  });

  it("rejects a kind it cannot route", async () => {
    // A newer sandbox bundle against an older host. The compile-time half of this is
    // the `never` assignment in the default branch: `tsc` fails if a member of
    // `SandboxHostRequest` is added and nothing routes it.
    const { handler } = handlerFor(["ai", "statusbar"]);
    await expect(
      handler({ kind: "editor_get_content" } as never, noop),
    ).rejects.toThrow(/unsupported host request/);
  });

  it("never reaches a service when the kind is unroutable", async () => {
    const showToast = vi.fn();
    const handler = createHostRequestHandler({
      aiFactory: () => ai,
      capabilities: ["ai", "statusbar"],
      declaredSettings: [],
      declaredStatusBarIds: [],
      pluginId: "p",
      showToast,
    });
    await expect(handler({ kind: "ui_" } as never, noop)).rejects.toThrow();
    expect(showToast).not.toHaveBeenCalled();
  });
});
