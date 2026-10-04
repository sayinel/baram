// The fake editor and handler harness shared by the host editor bridge's test files
// (`host-editor-bridge.test.ts`, `host-editor-bridge.insert.test.ts`). Moved out of the first
// so the §388 rows could live in their own file instead of growing it.
import type { PluginEditorHandle } from "../../extension-context";
import type { SandboxHostRequest } from "../protocol";

import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Transaction } from "@tiptap/pm/state";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { markdownToProsemirror } from "../../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../../pipeline/pm-to-md";
import { createEditorRequestHandler } from "../host-editor-bridge";

// §260 Phase 4b — a real `EditorState` over a small real `Schema`, with only the view faked —
// the same idiom the pipeline tests use. Faking the document instead would mean faking
// ProseMirror nodes for `prosemirrorToMarkdown` to walk, which tests the fake rather than the
// bridge.
//
// ‼️ The state has NO plugins, so the selection-anchor plugin is absent and a ref does not
// follow a transaction (§388). Rows here can only drive flows with no transaction between
// the read and the write; the tracking flows run on a real Editor in
// `src/plugins/__tests__/editor-ops*.test.ts`.
export const schema = new Schema({
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

/**
 * Derived from the protocol, exactly as `host-editor-bridge` derives it internally — stated
 * here rather than exported from production, so the type is not a test-only API.
 */
type EditorRequest = Extract<SandboxHostRequest, { kind: `editor_${string}` }>;

/**
 * Every `editor_*` request the protocol declares, as a callable request object.
 *
 * The union in `protocol.ts` is the source of truth for WHICH ops exist, so it is read
 * rather than restated — a guard that enumerates cannot fail when a member is added.
 *
 * ‼️ A source scan finds *a* match, not *the* match: the count is asserted, and any kind
 * without an argument recipe throws rather than being skipped, so a new op fails this file
 * instead of quietly escaping every loop that uses it.
 */
export function everyEditorRequest(): EditorRequest[] {
  const protocol = readFileSync(resolve(__dirname, "../protocol.ts"), "utf8");
  const kinds = [
    ...new Set(
      [...protocol.matchAll(/kind: "(editor_\w+)"/gu)].map((m) => m[1]),
    ),
  ];
  // Six today: get_markdown, get_selection, get_text, insert_markdown, insert_text,
  // set_markdown. Asserted as "at least the ones this file knows about" so adding an op
  // raises the floor rather than tripping an unrelated equality.
  if (kinds.length < 6) {
    throw new Error(
      `only found ${kinds.length} editor_* kinds in protocol.ts — the scan is broken`,
    );
  }
  const args: Record<string, Record<string, unknown>> = {
    editor_insert_markdown: { markdown: "x" },
    editor_insert_text: { text: "x" },
    editor_set_markdown: { markdown: "# b\n" },
  };
  return kinds.map((kind) => {
    if (kind.startsWith("editor_get_")) return { kind } as EditorRequest;
    const extra = args[kind];
    if (!extra) {
      throw new Error(
        `${kind} has no argument recipe here — add one so it is actually exercised`,
      );
    }
    return { kind, ...extra } as EditorRequest;
  });
}

/** A live-editor stand-in whose dispatched transactions really apply. */
export function fakeEditor(markdown: string) {
  let state = EditorState.create({
    doc: markdownToProsemirror(markdown, schema),
    schema,
  });
  const dispatched: Transaction[] = [];
  const handle: PluginEditorHandle = {
    chain: () => ({}),
    commands: {},
    getHTML: () => "",
    // Tiptap's own default block separator is "\n\n" — matched here so the "not a
    // flat-string slice" test contrasts against what production really did, rather
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

export function harness(
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
    // Stated, not inherited: the real default is BLOCKED until the app reports the surface
    // (code review M4), so a harness that wants the normal case has to say so.
    surfaceBlocked: () => null,
    ...overrides,
  });
  return { editor, handler, staged };
}
