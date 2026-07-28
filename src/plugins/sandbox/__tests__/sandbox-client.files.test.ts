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
//
// §260 Phase 4a — paths are CONTEXT-RELATIVE (Rust refuses an absolute one), and
// `opts.context` must reach the op, or a call aimed at the vault an event came from
// would silently resolve against whichever vault is active when it lands.
describe("startSandboxClient files (§260 3c-2c)", () => {
  it("routes ctx.files through the broker with exact op shapes", async () => {
    const ops: PluginOp[] = [];
    const broker = vi.fn(async (op: PluginOp) => {
      ops.push(op);
      if (op.kind === "source_read") return "// bundle";
      if (op.kind === "files_read") return "# note";
      // §260 Phase 4c — a listing crosses as a JSON string (it is the broker result that
      // crosses 8 KiB first, and a bare array is what tauri's queue takes).
      if (op.kind === "files_list") return JSON.stringify(["a.md", "b.md"]);
      return null;
    });
    const { host, sandbox } = createChannelPair();
    let readResult: unknown;
    let listResult: unknown;
    startSandboxClient(
      sandbox,
      async () => ({
        activate: async (ctx: SandboxContext) => {
          readResult = await ctx.files.readFile("note.md");
          await ctx.files.writeFile("notes/a.md", "# edited", {
            context: "ctx-7",
          });
          listResult = await ctx.files.listDir("");
        },
      }),
      broker,
    );
    const s = new SandboxSession(host);
    await s.activate("p", { commands: [] });

    // Compared AFTER a JSON round-trip, because that is the wire format Tauri uses and
    // it is the only way to see that `context: undefined` leaves no key at all —
    // `toEqual` treats an undefined-valued key as absent, so it would pass either way.
    // Rust reads a missing `Option<String>` as `None` and anchors to the active context;
    // a key present with a `null` value would be a different contract.
    const wire = ops
      .filter((o) => o.kind !== "source_read")
      .map((o) => JSON.parse(JSON.stringify(o)) as unknown);
    expect(wire).toStrictEqual([
      { kind: "files_read", path: "note.md" },
      {
        content: "# edited",
        context: "ctx-7",
        kind: "files_write",
        path: "notes/a.md",
      },
      { kind: "files_list", path: "" },
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
            await ctx.files.writeFile("note.md", "x");
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
