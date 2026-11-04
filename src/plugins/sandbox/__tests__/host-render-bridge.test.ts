// §394 spec 0073 D13 · plan 0125 P11 — the host side of `render_*`: gated on `codeblocks` like the
// ai, editor, settings and ui bridges on their own grants.
import type { PluginCapability } from "../../types";

import { describe, expect, it, vi } from "vitest";

import { createRenderRequestHandler } from "../host-render-bridge";

function handler(capabilities: PluginCapability[]) {
  const invalidate = vi.fn();
  const stage = vi.fn(async (_pluginId: string, _payload: string) => {});
  const call = createRenderRequestHandler({
    capabilities,
    invalidate,
    pluginId: "p",
    renderSource: (id) => (id === "render-1" ? "src" : undefined),
    stage,
  });
  return { call, invalidate, stage };
}

describe("createRenderRequestHandler", () => {
  /** What fails this: no `codeblocks` gate — both requests would reach the code-blocks API. The
   *  pair: with the grant, the same two requests stage the source and invalidate. Refused BEFORE
   *  the work, as the settings bridge refuses: nothing staged, nothing invalidated. */
  it("refuses both requests without codeblocks, and serves them with it", async () => {
    const denied = handler(["commands"]);
    for (const request of [
      { id: "render-1", kind: "render_get_source" },
      { kind: "render_invalidate", lang: "chart" },
    ] as const) {
      await expect(denied.call(request)).rejects.toThrow(
        /requires the "codeblocks" capability/,
      );
    }
    expect(denied.stage).not.toHaveBeenCalled();
    expect(denied.invalidate).not.toHaveBeenCalled();

    const granted = handler(["codeblocks"]);
    await expect(
      granted.call({ id: "render-1", kind: "render_get_source" }),
    ).resolves.toBeUndefined();
    await expect(
      granted.call({ kind: "render_invalidate", lang: "chart" }),
    ).resolves.toBeUndefined();
    expect(granted.stage).toHaveBeenCalledWith("p", "src");
    expect(granted.invalidate).toHaveBeenCalledWith("chart");
  });
});
