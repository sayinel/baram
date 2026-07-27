import type { PluginEditorHandle } from "../../extension-context";

import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { describe, expect, it, vi } from "vitest";

import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../../pipeline/pm-to-md";
import {
  createEditorRequestHandler,
  DOCUMENT_BUDGET_BURST,
  DOCUMENT_BUDGET_REFILL_PER_SECOND,
  WRITE_BURST,
  WRITE_PER_SECOND,
} from "../host-editor-bridge";

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
    // Tiptap's own default block separator is "\n\n" — matched here so the "not a
    // flat-string slice" test below contrasts against what production really did, rather
    // than against a friendlier fake (§260 Phase 4b code review, N3).
    getText: () => state.doc.textBetween(0, state.doc.content.size, "\n\n"),
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
    /** What `editor.view.updateState()` does: a DIFFERENT document, same instance. */
    installDocument: (doc: ReturnType<typeof markdownToProsemirror>) => {
      state = EditorState.create({ doc, schema });
    },
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

/**
 * One paragraph of `size` characters — a document with a large `content.size` that is
 * still cheap to build and serialize, so the budget can be exercised against the real
 * constants rather than injected ones.
 */
function longDocument(size: number): string {
  return `${"x".repeat(size)}\n`;
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

  it("throttles whole-document reads by SIZE, and recovers as the budget refills", async () => {
    // §260 Phase 4b security review (MEDIUM-1) — a ~90-byte request buys a full
    // `prosemirrorToMarkdown` walk plus an IPC copy, and the sandbox realm can drive the
    // transport command directly at `RateClass::Transport`'s 150/s. Nothing upstream can
    // bound that: the cost is in the document, not the request.
    let clock = 1_000_000;
    const { handler } = harness(
      longDocument(DOCUMENT_BUDGET_BURST / 4),
      ["editor:readonly"],
      { now: () => clock },
    );

    // A polling loop is refused well before it can freeze the thread.
    let admitted = 0;
    let refusal = "";
    for (let i = 0; i < 20; i++) {
      try {
        await handler({ kind: "editor_get_markdown" });
        admitted++;
      } catch (e) {
        refusal = (e as Error).message;
        break;
      }
    }
    expect(refusal).toMatch(/document budget is exhausted/);
    // Roughly burst ÷ document size — the point is that it is FINITE and small, not the
    // exact count, which node-boundary bytes shift by one either way.
    expect(admitted).toBeGreaterThan(0);
    expect(admitted).toBeLessThanOrEqual(5);

    // …and it is a throttle, not a ban: enough time refills the whole burst.
    clock += (DOCUMENT_BUDGET_BURST / DOCUMENT_BUDGET_REFILL_PER_SECOND) * 1000;
    await expect(
      handler({ kind: "editor_get_markdown" }),
    ).resolves.toBeUndefined();
  });

  it("does not throttle an ordinary document at the same call count", async () => {
    // The property that makes it a BYTE budget rather than a call limit: the loop that was
    // refused above runs freely on a note, so the meter prices the work instead of
    // punishing a plugin for asking.
    const { handler, staged } = harness("# Title\n\nBody text.\n", ["editor"]);
    for (let i = 0; i < 20; i++) {
      await handler({ kind: "editor_get_markdown" });
    }
    expect(staged).toHaveLength(20);
  });

  it("refuses every op when the editor is not the tab's content", async () => {
    // §260 Phase 4b security review (LOW-3) — in source mode the user edits CodeMirror
    // while the Tiptap doc keeps its pre-toggle content, and `handleSave` ignores that doc
    // entirely. A read would be silently stale and a write silently dropped, so both are
    // refused with a reason the plugin can show.
    const { editor, handler, staged } = harness("# a\n", ["editor"], {
      surfaceBlocked: () => "the document is open in source mode",
    });

    for (const request of [
      { kind: "editor_get_markdown" },
      { kind: "editor_get_selection" },
      { kind: "editor_insert_text", text: "x" },
      { kind: "editor_set_markdown", markdown: "# b\n" },
    ] as const) {
      await expect(handler(request)).rejects.toThrow(/source mode/);
    }
    // Distinguishable from "no editor is open": a plugin that cannot tell them apart
    // cannot tell the user what to do about it.
    await expect(handler({ kind: "editor_get_markdown" })).rejects.not.toThrow(
      /no editor is open/,
    );
    expect(staged).toEqual([]);
    expect(editor.dispatched).toEqual([]);
  });

  it("refuses to write when a tab switch installed another document mid-parse", async () => {
    // §260 Phase 4b security review, NEW HIGH. The ordinary tab switch calls
    // `editor.view.updateState(cachedState)` on the SAME editor with the SAME schema, so
    // the schema comparison this replaced passed and the write landed in ANOTHER FILE —
    // then marked it dirty, so autosave could put it on disk. The previous test only built
    // a distinct Schema, i.e. it exercised the path that WAS caught.
    const editor = fakeEditor("# file A\n");
    const otherFile = markdownToProsemirror(
      "# file B — do not touch\n",
      schema,
    );
    const handler = createEditorRequestHandler({
      capabilities: ["editor"] as never,
      editor: () => editor.handle,
      pluginId: "acme.notes",
      stage: vi.fn(),
    });

    const writing = handler({
      kind: "editor_set_markdown",
      markdown: "# replacement\n",
    });
    editor.installDocument(otherFile); // the tab switch — same instance, same schema

    await expect(writing).rejects.toThrow(/document changed/);
    expect(editor.dispatched).toEqual([]);
    expect(editor.markdown()).toBe("# file B — do not touch\n");
  });

  it("still writes when nothing displaced the document", async () => {
    // The guard must not make `setMarkdown` simply not work — the counterpart to the test
    // above, so a refusal that is always true would fail here.
    const { editor, handler } = harness("# old\n", ["editor"]);
    await handler({ kind: "editor_set_markdown", markdown: "# new\n" });
    expect(editor.markdown()).toBe("# new\n");
  });

  it("refuses reads and writes while a document is still loading progressively", async () => {
    // §260 Phase 4b security review, Q6 — during a large-document tab switch the editor
    // holds only the first chunk, so a read returns a TRUNCATED document and a
    // read-modify-write would save the truncation back.
    const { editor, handler, staged } = harness("# a\n", ["editor"], {
      surfaceBlocked: () => "the document is still loading",
    });
    await expect(handler({ kind: "editor_get_markdown" })).rejects.toThrow(
      /still loading/,
    );
    await expect(
      handler({ kind: "editor_set_markdown", markdown: "# b\n" }),
    ).rejects.toThrow(/still loading/);
    expect(staged).toEqual([]);
    expect(editor.dispatched).toEqual([]);
  });

  it("throttles WRITES by transaction count, not by payload size", async () => {
    // §260 Phase 4b security review, Q2 — `view.dispatch` forces a whole-contenteditable
    // layout (~53 ms on a large document, per the C4 handoff notes), so cost tracks the
    // DOCUMENT, not the edit. A 4 KiB insert at the transport's 150/s is a hard freeze;
    // pricing the payload cannot see it.
    let clock = 1_000_000;
    const { handler } = harness("# a\n", ["editor"], { now: () => clock });

    for (let i = 0; i < WRITE_BURST; i++) {
      await handler({ kind: "editor_insert_text", text: "x" });
    }
    await expect(
      handler({ kind: "editor_insert_text", text: "x" }),
    ).rejects.toThrow(/write budget is exhausted/);

    clock += (WRITE_BURST / WRITE_PER_SECOND) * 1000;
    await expect(
      handler({ kind: "editor_insert_text", text: "x" }),
    ).resolves.toBeUndefined();
  });

  it("never makes a large document permanently unreadable", async () => {
    // §260 Phase 4b security review, Q4 — tokens cap at the burst, so an unclamped charge
    // above it could never be paid: the document would be unreadable forever while the
    // error advised waiting, which could not help. A user can open a note this size and
    // Rust stages up to 8 MiB, so this is reachable, not theoretical.
    let clock = 1_000_000;
    const { handler } = harness(
      longDocument(DOCUMENT_BUDGET_BURST + 1_000),
      ["editor:readonly"],
      { now: () => clock },
    );

    await expect(
      handler({ kind: "editor_get_markdown" }),
    ).resolves.toBeUndefined();
    // Charged the whole burst, so the next read waits — a throttle, not a wall.
    await expect(handler({ kind: "editor_get_markdown" })).rejects.toThrow(
      /document budget is exhausted/,
    );
    clock += (DOCUMENT_BUDGET_BURST / DOCUMENT_BUDGET_REFILL_PER_SECOND) * 1000;
    await expect(
      handler({ kind: "editor_get_markdown" }),
    ).resolves.toBeUndefined();
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
