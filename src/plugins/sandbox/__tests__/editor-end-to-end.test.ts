import type { SandboxContext } from "../../types";
import type { PluginOp } from "../plugin-op";
import type { HostToSandbox } from "../protocol";

import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../../pipeline/pm-to-md";
import { createHostRequestHandler } from "../host-request-router";
import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

// §260 Phase 4b — real client ↔ real session, with the STAGING round trip closed by a fake
// Rust. The unit tests cover each half; this is where the property that motivated the whole
// design is observable: the document must never appear in a frame sent to the sandbox.
describe("editor end-to-end: real client ↔ real session (§260 Phase 4b)", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      heading: {
        attrs: { blockId: { default: null }, level: { default: 1 } },
        content: "inline*",
        group: "block",
      },
      paragraph: {
        attrs: { blockId: { default: null } },
        content: "inline*",
        group: "block",
      },
      text: { group: "inline" },
    },
  });
  // Well over tauri's 8 KiB channel-data threshold — the size that makes this phase's
  // problem real. Expected value comes from the same pipeline, because what is under test
  // here is the transport, not serializer fidelity (that is `host-editor-bridge.test.ts`).
  const SOURCE = `# Title\n\n${"Body paragraph. ".repeat(800).trim()}\n`;
  const doc = markdownToProsemirror(SOURCE, schema);
  const DOCUMENT = prosemirrorToMarkdown(doc);

  async function pair(
    capabilities: string[],
    selection: { from: number; to: number } = { from: 1, to: 5 },
  ) {
    // Stands in for `StagedPayloads` + `plugin_call staged_read`: one slot, consumed on
    // read, keyed per plugin — the same contract `plugin/staging.rs` implements.
    let slot: null | string = null;
    const pulls: string[] = [];

    const broker = async (op: PluginOp) => {
      if (op.kind === "source_read") return "// bundle";
      if (op.kind === "staged_read") {
        if (slot === null) throw new Error("nothing is staged for this plugin");
        const payload = slot;
        slot = null;
        pulls.push(payload);
        return payload;
      }
      return undefined;
    };

    const { host, sandbox } = createChannelPair();
    // Record every frame the HOST sends to the sandbox — the wire this test polices.
    const framesToSandbox: HostToSandbox[] = [];
    const recordingHost = {
      ...host,
      send: (m: HostToSandbox) => {
        framesToSandbox.push(m);
        host.send(m);
      },
    };

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
      recordingHost,
      createHostRequestHandler({
        capabilities: capabilities as never,
        declaredSettings: [],
        declaredStatusBarIds: [],
        editor: () => fakeEditorHandle(selection),
        pluginId: "p",
        stage: async (_pluginId, payload) => {
          slot = payload;
        },
        surfaceBlocked: () => null,
      }),
    );
    await session.activate("p", { commands: [] });
    if (!ctx) throw new Error("activate did not run");
    return { ctx, framesToSandbox, pulls, session };
  }

  /** A handle over the real document above; only the view is absent (no writes here). */
  function fakeEditorHandle(selection: { from: number; to: number }) {
    return { schema, state: { doc, selection } } as never;
  }

  it("delivers the document through the staged pull, never in a frame", async () => {
    const { ctx, framesToSandbox, pulls } = await pair(["editor"]);

    const markdown = await ctx.editor.getMarkdown();

    expect(markdown).toBe(DOCUMENT);
    expect(pulls).toEqual([DOCUMENT]); // it really came through the broker
    // THE property: no frame the host sent carries the document. A frame this size would
    // enter tauri's app-global channel-data queue, which is ACL-exempt and keyed by a
    // guessable sequential id — readable by any other sandboxed plugin.
    const wire = JSON.stringify(framesToSandbox);
    expect(wire).not.toContain("Body paragraph.");
    expect(wire.length).toBeLessThan(2_000);
  });

  // §4.8 `getText` — the member whose ABSENCE made the Word Count plugin count `#` and `|`
  // as words. It travels the same staged path as `getMarkdown` for the same reason: prose is
  // only a little smaller than its source, so it clears tauri's 8 KiB threshold too.
  it("delivers the document's prose through the staged pull, never in a frame", async () => {
    const { ctx, framesToSandbox, pulls } = await pair(["editor:readonly"]);

    const text = await ctx.editor.getText();

    // The markdown reader on the same document keeps its `# ` — this one does not.
    expect(await ctx.editor.getMarkdown()).toContain("# Title");
    expect(text).not.toContain("#");
    expect(text).toContain("Title");
    expect(text).toContain("Body paragraph.");
    expect(pulls).toContain(text);
    const wire = JSON.stringify(framesToSandbox);
    expect(wire).not.toContain("Body paragraph.");
  });

  it("refuses getText without an editor-read capability", async () => {
    const { ctx } = await pair(["ui"]);
    await expect(ctx.editor.getText()).rejects.toThrow(/requires one of/u);
  });

  it("serialises concurrent reads instead of racing one slot", async () => {
    // Rust holds ONE staged slot per plugin. Two reads in flight would otherwise have the
    // first pull take the second document and the second find the slot empty.
    const { ctx, pulls } = await pair(["editor:readonly"]);

    const both = await Promise.all([
      ctx.editor.getMarkdown(),
      ctx.editor.getMarkdown(),
    ]);

    expect(both).toEqual([DOCUMENT, DOCUMENT]);
    expect(pulls).toHaveLength(2);
  });

  it("recombines a staged selection: text from the pull, positions from the frame", async () => {
    // §260 Phase 4b re-review (M2) — the CLIENT half of the staged-selection protocol had
    // no test. `getSelection` is the one call that splits its answer across both
    // transports, and the recombination lived only in `sandbox-client`, which no test
    // drove. This is the shape `tauri-host-transport`'s own header warns about: a protocol
    // change whose new half the machinery tests do not exercise.
    const { ctx, framesToSandbox, pulls } = await pair(["editor:readonly"]);

    const selection = await ctx.editor.getSelection();

    expect(selection.from).toBe(1);
    expect(selection.to).toBe(5);
    expect(selection.text).toBe(doc.textBetween(1, 5, "\n"));
    expect(pulls).toEqual([selection.text]); // it really came through the broker
    // And the text was never in a frame, same as `getMarkdown`.
    expect(JSON.stringify(framesToSandbox)).not.toContain(selection.text);
  });

  it("answers a bare caret without touching the staged slot", async () => {
    // The `staged: false` fast path (N1). Deleting the client's early return leaves the
    // broker throwing "nothing is staged" — which nothing noticed, because nothing called
    // `getSelection` through the real client.
    const { ctx, pulls } = await pair(["editor:readonly"], { from: 3, to: 3 });

    const selection = await ctx.editor.getSelection();

    expect(selection).toEqual({ from: 3, text: "", to: 3 });
    expect(pulls).toEqual([]); // no pull at all
  });

  it("surfaces a capability denial to plugin code", async () => {
    const { ctx } = await pair(["files"]);
    await expect(ctx.editor.getMarkdown()).rejects.toThrow(/requires one of/);
    await expect(ctx.editor.setMarkdown("# x\n")).rejects.toThrow(
      /requires one of/,
    );
  });

  it("a failed read does not wedge the next one", async () => {
    // The read chain must not stay poisoned: `stagedReads` is rebuilt from a settled
    // promise either way, so one rejection cannot strand every later read.
    const { ctx } = await pair(["files"]);
    await expect(ctx.editor.getMarkdown()).rejects.toThrow();
    await expect(ctx.editor.getMarkdown()).rejects.toThrow(/requires one of/);
  });
});
