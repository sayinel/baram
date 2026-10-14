import type { SandboxContext } from "../../types";
import type { PluginOp } from "../plugin-op";

import { describe, expect, it, vi } from "vitest";

import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

// §393 — `ctx.index` must send exactly the ops the Rust `PluginOp` deserializes (internally
// tagged on `kind`, snake_case — `authorizer.rs`'s `index_ops_deserialize_from_the_clients_wire_shape`
// reads the same JSON), and hand the plugin each answer parsed from the JSON string Rust sends
// (`BrokerResult::encoded`). The authorization, the paths and the refusals are Rust's.
describe("startSandboxClient index (§393)", () => {
  it("routes ctx.index through the broker with exact op shapes", async () => {
    const ops: PluginOp[] = [];
    const broker = vi.fn(async (op: PluginOp) => {
      ops.push(op);
      if (op.kind === "source_read") return "// bundle";
      if (op.kind === "index_search")
        return JSON.stringify({ items: [], truncated: false });
      return JSON.stringify([]);
    });
    const { host, sandbox } = createChannelPair();
    startSandboxClient(
      sandbox,
      async () => ({
        activate: async (ctx: SandboxContext) => {
          await ctx.index.backlinks("notes/a.md");
          await ctx.index.links("notes/a.md", { context: "ctx-7" });
          await ctx.index.notesWithTag("#work");
          await ctx.index.search("needle", {
            context: "ctx-7",
            folder: "docs",
            limit: 5,
            regex: true,
          });
          await ctx.index.search("plain");
          await ctx.index.tags();
          await ctx.index.tasks({ file: "notes/a.md", status: "all" });
        },
      }),
      broker,
    );
    const s = new SandboxSession(host);
    await s.activate("p", { commands: [] });

    // After a JSON round-trip, the wire format Tauri uses: an undefined `context` leaves no key,
    // which Rust reads as `None` (the active context).
    const wire = ops
      .filter((o) => o.kind !== "source_read")
      .map((o) => JSON.parse(JSON.stringify(o)) as unknown);
    expect(wire).toStrictEqual([
      { kind: "index_backlinks", path: "notes/a.md" },
      { context: "ctx-7", kind: "index_links", path: "notes/a.md" },
      { kind: "index_tag_notes", tag: "#work" },
      {
        context: "ctx-7",
        kind: "index_search",
        options: { folder: "docs", limit: 5, regex: true },
        query: "needle",
      },
      { kind: "index_search", options: {}, query: "plain" },
      { kind: "index_tags" },
      { file: "notes/a.md", kind: "index_tasks", status: "all" },
    ]);
  });

  it("hands the plugin the parsed answer, and a refusal un-softened", async () => {
    const row = {
      blockId: null,
      line: 3,
      path: "z.md",
      snippet: "[[a]]",
      type: "wikilink",
    };
    const broker = vi.fn(async (op: PluginOp) => {
      if (op.kind === "source_read") return "// bundle";
      if (op.kind === "index_backlinks") return JSON.stringify([row]);
      throw new Error("this plugin was not granted files or files:readonly");
    });
    let answer: unknown;
    let refusal = "";
    const { host, sandbox } = createChannelPair();
    startSandboxClient(
      sandbox,
      async () => ({
        activate: async (ctx: SandboxContext) => {
          answer = await ctx.index.backlinks("a.md");
          try {
            await ctx.index.tags();
          } catch (e) {
            refusal = (e as Error).message;
          }
        },
      }),
      broker,
    );
    const s = new SandboxSession(host);
    await s.activate("p", { commands: [] });

    expect(answer).toStrictEqual([row]);
    expect(refusal).toContain("files:readonly");
  });
});
