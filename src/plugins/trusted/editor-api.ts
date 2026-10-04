// §388 spec 0067 — the trusted tier's `EditorAPI`, on the core both tiers share
// (`editor-ops.ts`). Split out of `extension-context.ts` as `createUIAPI` was, so that file
// stops growing with every editor operation.
import type { EditorAPI } from "../types";

import { serializeEditorState } from "../../utils/editor/serialize-live-doc";
import { documentProseText } from "../../utils/word-count";
import {
  insertMarkdownAt,
  insertTextAt,
  liveEditor,
  readSelectionForPlugin,
  replaceDocument,
} from "../editor-ops";
import { EditorRefusalError } from "../editor-refusal";
import {
  editorSurfaceBlocked,
  getEditorInstance,
} from "../plugin-host-registry";

export function createEditorAPI(
  readonly: boolean,
  pluginId: string,
): EditorAPI {
  /**
   * The live editor, or a refusal — the trusted tier's twin of `host-editor-bridge`'s `live()`
   * (#322). Every method used to consult only `editorInstance`, so all five stale-surface states
   * reached it: source mode, a non-markdown tab, a progressive load, the deferred window at the
   * start of a tab switch, and no tabs at all. In each one a read was silently STALE and a write
   * silently DISCARDED — by the next save, the next source-mode toggle, or the pending
   * `updateState`. A plugin doing read-modify-write lost the user's edits and the API reported
   * success.
   *
   * ‼️ Throwing where it used to return `""` / `{from:0,to:0,text:""}` / nothing is a deliberate
   * behaviour change, and the benign-looking defaults were the dangerous part: a plugin that
   * cannot tell "no editor" from "empty file" reads `""`, transforms it, writes it back, and has
   * emptied the document. The sandboxed tier made the same call in Phase 4b. The blast radius is
   * every trusted plugin granted an editor capability, registry installs included — the registry
   * now carries a trusted tier (`bullet-threading`, which requests no editor capability and so
   * is not itself affected).
   */
  const ctx = {
    live: (method: string) =>
      liveEditor(method, editorSurfaceBlocked, getEditorInstance),
    owner: pluginId,
  };
  // Checked before anything else a write does, so a readonly plugin is told about its
  // capability and not about a surface state it can do nothing about.
  const writable = (method: string): void => {
    if (readonly) {
      throw new EditorRefusalError(
        "not-permitted",
        `editor:readonly — ${method} is not allowed`,
      );
    }
  };
  return {
    async getMarkdown() {
      return serializeEditorState(ctx.live("getMarkdown").state);
    },
    async getSelection() {
      return readSelectionForPlugin(ctx, "getSelection", { record: !readonly });
    },
    async getText() {
      return documentProseText(ctx.live("getText").state.doc);
    },
    async insertMarkdown(markdown, opts) {
      writable("insertMarkdown");
      await insertMarkdownAt(ctx, { markdown, ref: opts?.replace });
    },
    async insertText(text, opts) {
      writable("insertText");
      insertTextAt(ctx, { ref: opts?.replace, text });
    },
    async setMarkdown(markdown) {
      writable("setMarkdown");
      await replaceDocument(ctx, { markdown });
    },
  };
}
