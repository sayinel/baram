import type { PluginOp } from "../plugin-op";
import type { SandboxContext } from "../sandbox-client";

import { describe, expect, it, vi } from "vitest";

import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

// §260 Phase 3c-2c — `ctx.files` must produce exactly the ops the Rust `PluginOp`
// serde contract deserializes (internally tagged on `kind`, snake_case). The
// authorization and the vault bound live in Rust; what is testable here is the
// wire shape and that a denial is not swallowed.
describe("startSandboxClient files (§260 3c-2c)", () => {
  it("routes ctx.files through the broker with exact op shapes", async () => {
    const ops: PluginOp[] = [];
    const broker = vi.fn(async (op: PluginOp) => {
      ops.push(op);
      if (op.kind === "source_read") return "// bundle";
      if (op.kind === "files_read") return "# note";
      if (op.kind === "files_list") return ["a.md", "b.md"];
      return null;
    });
    const { host, sandbox } = createChannelPair();
    let readResult: unknown;
    let listResult: unknown;
    startSandboxClient(
      sandbox,
      async () => ({
        activate: async (ctx: SandboxContext) => {
          readResult = await ctx.files.readFile("/v/note.md");
          await ctx.files.writeFile("/v/note.md", "# edited");
          listResult = await ctx.files.listDir("/v");
        },
      }),
      broker,
    );
    const s = new SandboxSession(host);
    await s.activate("p", { commands: [] });

    expect(ops.filter((o) => o.kind !== "source_read")).toEqual([
      { kind: "files_read", path: "/v/note.md" },
      { kind: "files_write", content: "# edited", path: "/v/note.md" },
      { kind: "files_list", path: "/v" },
    ]);
    expect(readResult).toBe("# note");
    expect(listResult).toEqual(["a.md", "b.md"]);
  });

  it("propagates a broker denial to the plugin instead of swallowing it", async () => {
    // A sandbox that turned a deny into `undefined` would let plugin code proceed
    // as if a write had happened — the failure mode a capability check exists to
    // prevent. The client must not interpret broker results at all.
    const broker = vi.fn(async (op: PluginOp) => {
      if (op.kind === "source_read") return "// bundle";
      throw new Error("this plugin was not granted files");
    });
    const { host, sandbox } = createChannelPair();
    let caught: unknown;
    startSandboxClient(
      sandbox,
      async () => ({
        activate: async (ctx: SandboxContext) => {
          try {
            await ctx.files.writeFile("/v/note.md", "x");
          } catch (e) {
            caught = e;
          }
        },
      }),
      broker,
    );
    const s = new SandboxSession(host);
    await s.activate("p", { commands: [] });

    expect((caught as Error).message).toContain("not granted files");
  });
});
