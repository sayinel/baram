import type { PluginEditorHandle } from "../../extension-context";

import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";

import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../../pipeline/pm-to-md";
import { createEditorRequestHandler } from "../host-editor-bridge";

// §260 Phase 4b — the sandboxed tier's document access. The editor lives in the main
// realm, so this is where the capability check has to be enforcing, and where the design's
// central property lives: a document is STAGED, never returned in the response frame.
//
// A real `EditorState` over a small real `Schema`, with only the view faked — the same
// idiom the pipeline tests use. Faking the document instead would mean faking ProseMirror
// nodes for `prosemirrorToMarkdown` to walk, which tests the fake rather than the bridge.
const schema = new Schema({
  marks: {
    // Tiptap's names — the pipeline looks marks up by these, not by the HTML tag.
    bold: { parseDOM: [{ tag: "strong" }], toDOM: () => ["strong", 0] },
    italic: { parseDOM: [{ tag: "em" }], toDOM: () => ["em", 0] },
  },
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
      marks: "_",
    },
    text: { group: "inline" },
  },
});

/** A live-editor stand-in whose dispatched transactions really apply. */
function fakeEditor(markdown: string) {
  let state = EditorState.create({
    doc: markdownToProsemirror(markdown, schema),
    schema,
  });
  const dispatched: unknown[] = [];
  const handle: PluginEditorHandle = {
    chain: () => ({}),
    commands: {},
    getHTML: () => "",
    getText: () => state.doc.textBetween(0, state.doc.content.size, "\n"),
    schema,
    get state() {
      return state;
    },
    view: {
      dispatch: (tr) => {
        dispatched.push(tr);
        state = state.apply(tr);
      },
    },
  } as PluginEditorHandle;
  return {
    dispatched,
    handle,
    markdown: () => prosemirrorToMarkdown(state.doc),
    select: (from: number, to: number) => {
      state = state.apply(
        state.tr.setSelection(TextSelection.create(state.doc, from, to)),
      );
    },
  };
}

function harness(
  markdown: string,
  capabilities: string[],
  overrides: Partial<Parameters<typeof createEditorRequestHandler>[0]> = {},
) {
  const editor = fakeEditor(markdown);
  const staged: Array<[string, string]> = [];
  const handler = createEditorRequestHandler({
    capabilities: capabilities as never,
    editor: () => editor.handle,
    pluginId: "acme.notes",
    stage: async (pluginId, payload) => void staged.push([pluginId, payload]),
    ...overrides,
  });
  return { editor, handler, staged };
}

describe("createEditorRequestHandler (§260 Phase 4b)", () => {
  it("stages the document instead of answering with it", async () => {
    // THE property this phase exists for. A frame carrying the document would enter
    // tauri's app-global channel-data queue, which is ACL-exempt and keyed by a guessable
    // sequential id — i.e. readable by any other sandboxed plugin.
    const { handler, staged } = harness("# Title\n\nBody text.\n", ["editor"]);

    const answer = await handler({ kind: "editor_get_markdown" });

    expect(answer).toBeUndefined();
    expect(staged).toEqual([["acme.notes", "# Title\n\nBody text.\n"]]);
  });

  it("finishes staging BEFORE it answers", async () => {
    // Resolving is what tells the sandbox to pull. Answering first would race it to an
    // empty slot — a flaky "nothing is staged for this plugin" under load.
    const order: string[] = [];
    let releaseStage: () => void = () => {};
    const { handler } = harness("# a\n", ["editor:readonly"], {
      stage: async () => {
        await new Promise<void>((resolve) => {
          releaseStage = resolve;
        });
        order.push("staged");
      },
    });

    const answering = handler({ kind: "editor_get_markdown" }).then(() =>
      order.push("answered"),
    );
    await Promise.resolve();
    expect(order).toEqual([]);

    releaseStage();
    await answering;
    expect(order).toEqual(["staged", "answered"]);
  });

  it("admits reads for either editor grant and writes only for the read-write one", async () => {
    const readonly = harness("# a\n", ["editor:readonly"]);
    await expect(
      readonly.handler({ kind: "editor_get_markdown" }),
    ).resolves.toBeUndefined();
    await expect(
      readonly.handler({ kind: "editor_insert_text", text: "x" }),
    ).rejects.toThrow(/"editor"/);
    await expect(
      readonly.handler({ kind: "editor_set_markdown", markdown: "# b\n" }),
    ).rejects.toThrow(/"editor"/);
    // The refused writes really did not happen.
    expect(readonly.editor.dispatched).toEqual([]);

    const full = harness("# a\n", ["editor"]);
    await expect(
      full.handler({ kind: "editor_insert_text", text: "x" }),
    ).resolves.toBeUndefined();
  });

  it("refuses everything without an editor grant", async () => {
    const { editor, handler, staged } = harness("# a\n", [
      "files",
      "statusbar",
    ]);
    for (const request of [
      { kind: "editor_get_markdown" },
      { kind: "editor_get_selection" },
      { kind: "editor_insert_text", text: "x" },
      { kind: "editor_set_markdown", markdown: "# b\n" },
    ] as const) {
      await expect(handler(request)).rejects.toThrow(/requires one of/);
    }
    expect(staged).toEqual([]);
    expect(editor.dispatched).toEqual([]);
  });

  it("returns selection text across a block boundary, not a flat-string slice", async () => {
    // §260 Phase 4b — the pre-existing bug this shares a fix with: `from`/`to` are
    // ProseMirror positions, which count node boundaries, so slicing `getText()` with them
    // drifts by one per block crossed and returns the wrong text for any real document.
    const { editor, handler } = harness("First para\n\nSecond para\n", [
      "editor:readonly",
    ]);
    // Select from inside the first paragraph to inside the second.
    editor.select(3, editor.handle.state.doc.content.size - 3);

    const selection = (await handler({ kind: "editor_get_selection" })) as {
      from: number;
      text: string;
      to: number;
    };

    expect(selection.text).toContain("rst para");
    expect(selection.text).toContain("Second pa");
    // The old implementation would have sliced the flat string by PM positions, losing the
    // boundary and the trailing characters.
    expect(selection.text).not.toBe(
      editor.handle.getText().slice(selection.from, selection.to),
    );
  });

  it("inserts text as ONE transaction, so it is one undo step", async () => {
    const { editor, handler } = harness("Hello\n", ["editor"]);
    editor.select(6, 6); // end of "Hello"

    await handler({ kind: "editor_insert_text", text: " world" });

    expect(editor.dispatched).toHaveLength(1);
    expect(editor.markdown()).toBe("Hello world\n");
  });

  it("replaces the document as ONE transaction and round-trips", async () => {
    // `setMarkdown(await getMarkdown())` must be a no-op on the document — the project's
    // first quality criterion, and the reason both directions use the app's own pipeline.
    const source = "# Title\n\nBody with **bold**.\n";
    const { editor, handler, staged } = harness("# old\n", ["editor"]);

    await handler({ kind: "editor_set_markdown", markdown: source });
    expect(editor.dispatched).toHaveLength(1);

    await handler({ kind: "editor_get_markdown" });
    expect(staged[0][1]).toBe(source);
  });

  it("says so when no editor is open, rather than reporting an empty document", async () => {
    // A plugin that cannot tell those apart would overwrite a real file with the
    // assumptions it drew from "".
    const handler = createEditorRequestHandler({
      capabilities: ["editor"] as never,
      editor: () => null,
      pluginId: "acme.notes",
      stage: vi.fn(),
    });
    await expect(handler({ kind: "editor_get_markdown" })).rejects.toThrow(
      /no editor is open/,
    );
    await expect(
      handler({ kind: "editor_set_markdown", markdown: "# b\n" }),
    ).rejects.toThrow(/no editor is open/);
  });
});
