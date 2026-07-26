// §260 Phase 4b — the host side of `editor` for sandboxed plugins.
//
// WHY the host: the document lives in the main realm as a ProseMirror state. There is
// nothing for Rust to broker — it has no document — so this is mediated like `ai` and
// `ui`, and the capability check here is enforcing because a `plugin-*` window can reach
// neither the store nor the DOM.
//
// WHY markdown both ways: it is the app's round-trippable form, and the pipeline that
// produces it (`prosemirrorToMarkdown` / `markdownToProsemirror`) is the same one the
// editor itself uses to load and save. A plugin therefore reads exactly what it can write
// back — round-trip preservation is the project's first quality criterion, and an `editor`
// API that broke it would be a way to corrupt documents through a "safe" tier.
import type { PluginCapability } from "../types";
import type { SandboxHostRequest } from "./protocol";

import { pluginSandboxStage } from "../../ipc/plugin-invoke";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import {
  getEditorInstance,
  type PluginEditorHandle,
  readSelection,
} from "../extension-context";

/** Reads are admitted by either grant; writes only by the read-write one. */
const READ_CAPABILITIES: readonly PluginCapability[] = [
  "editor",
  "editor:readonly",
];
const WRITE_CAPABILITIES: readonly PluginCapability[] = ["editor"];

export interface EditorRequestHandlerOptions {
  /** Grants recorded at install, as the manifest declared them. */
  capabilities: readonly PluginCapability[];
  /** Injectable for tests; defaults to the live editor. */
  editor?: () => null | PluginEditorHandle;
  pluginId: string;
  /** Injectable for tests; defaults to the host-only staging command. */
  stage?: (pluginId: string, payload: string) => Promise<void>;
}

type EditorRequest = Extract<SandboxHostRequest, { kind: `editor_${string}` }>;

export function createEditorRequestHandler(
  options: EditorRequestHandlerOptions,
): (request: EditorRequest) => Promise<unknown> {
  const {
    capabilities,
    editor = getEditorInstance,
    pluginId,
    stage = pluginSandboxStage,
  } = options;
  const granted = new Set(capabilities);

  const requireCapability = (
    accepted: readonly PluginCapability[],
    method: string,
  ) => {
    if (accepted.some((c) => granted.has(c))) return;
    throw new Error(
      `Plugin ${pluginId} requires one of ${accepted.map((c) => `"${c}"`).join(", ")} ` +
        `to call editor.${method}. Add it to the capabilities array in baram-plugin.json.`,
    );
  };

  /** The live editor, or a refusal the plugin can act on. */
  const live = (method: string): PluginEditorHandle => {
    const instance = editor();
    if (!instance) {
      // An error, not an empty document: a plugin that cannot tell "no editor" from "empty
      // file" would happily overwrite the latter with the former's assumptions.
      throw new Error(`editor.${method}: no editor is open`);
    }
    return instance;
  };

  return async (request: EditorRequest) => {
    switch (request.kind) {
      case "editor_get_markdown": {
        requireCapability(READ_CAPABILITIES, "getMarkdown");
        const markdown = prosemirrorToMarkdown(live("getMarkdown").state.doc);
        // Staged, never returned inline (see `plugin/staging.rs`). AWAITED before this
        // handler resolves, because resolving is what sends the response frame that tells
        // the sandbox to pull — answering first would race the sandbox to an empty slot.
        await stage(pluginId, markdown);
        return undefined;
      }
      case "editor_get_selection": {
        requireCapability(READ_CAPABILITIES, "getSelection");
        // Small by nature (a selection is what a user highlighted), so it answers inline.
        // `readSelection` is shared with the trusted tier so the position/offset rule
        // cannot diverge between them.
        return readSelection(live("getSelection"));
      }
      case "editor_insert_text": {
        requireCapability(WRITE_CAPABILITIES, "insertText");
        const instance = live("insertText");
        const { from, to } = instance.state.selection;
        // ONE transaction: ProseMirror's history groups by transaction, so this is a
        // single Cmd+Z for the user. `insertText` over the selection range is what makes
        // it behave like typing — replacing a selection rather than appending beside it.
        instance.view.dispatch(
          instance.state.tr.insertText(request.text, from, to),
        );
        return undefined;
      }
      case "editor_set_markdown": {
        requireCapability(WRITE_CAPABILITIES, "setMarkdown");
        const instance = live("setMarkdown");
        // Parsed with the LIVE schema, not a fresh one: a node built against a different
        // Schema instance fails ProseMirror's identity-based validation on insert (the
        // keep-alive lesson from the large-file work).
        const next = markdownToProsemirror(request.markdown, instance.schema);
        instance.view.dispatch(
          instance.state.tr.replaceWith(
            0,
            instance.state.doc.content.size,
            next.content,
          ),
        );
        return undefined;
      }
      default: {
        const unknown: never = request;
        throw new Error(
          `unsupported editor request: ${JSON.stringify(unknown)}`,
        );
      }
    }
  };
}
