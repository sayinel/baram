// §394 spec 0073 §4 · plan 0125 P13 · P29 — the `CodeBlockInfo` a render or an action carries: the
// note of the editor that HOLDS the block, read when the render starts — never the active tab's,
// which a background keep-alive editor's block, or the shared editor's in the moment after a tab
// switch, does not belong to. Which editor holds which tab's document is the map issue 594
// publishes for the block-ID rename landing (`documentSurfaceAccess` with `loadedTabId`), read
// here the other way round: a keep-alive editor holds its own tab's document while it lives, and
// the shared editor holds the document of the tab last installed in it (`markContentLoaded`) —
// unless that tab has a keep-alive editor of its own (the shared editor then holds a background
// document no record names), or the active tab is still loading into it (a cold load installs its
// first chunks and announces the tab only once the last chunk is in, `load-tab-content.ts`). In
// both cases no note is named. The path goes through the one translation sandboxed file events use
// (`locateInContext`).

import type { CodeBlockInfo, PluginTrust } from "../types";
import type { Editor } from "@tiptap/core";

import { useEditorStore } from "../../stores/editor/editor";
import {
  isTabLoading,
  loadedTabId,
} from "../../utils/editor/programmatic-update";
import { locateInContext } from "../locate-in-context";

/**
 * `lang`'s block in the note `editor` holds, as `tier` is allowed to see it — or `null` while
 * `editor` holds a document no tab can be named for (the view then waits, D7).
 */
export function codeBlockInfo(
  editor: Editor,
  lang: string,
  tier: PluginTrust,
): CodeBlockInfo | null {
  const filePath = heldFilePath(editor);
  if (filePath === undefined) return null;
  if (filePath === "") return { context: null, lang, path: null };
  const located = locateInContext(filePath);
  return {
    context: located?.context ?? null,
    lang,
    path: tier === "trusted" ? filePath : (located?.path ?? null),
  };
}

/**
 * The `filePath` of the tab whose document `editor` holds — `""` for an unsaved note, and for an
 * editor that is no tab's surface (the quick-capture dialog's, a test's — or any editor before
 * `useTabSwitching` publishes the map); `undefined` for the shared editor while the installed tab
 * lives in a keep-alive editor, while the active tab is loading into it, or once the installed tab
 * is closed.
 */
function heldFilePath(editor: Editor): string | undefined {
  const {
    activeTabId,
    documentSurfaceAccess: access,
    tabs,
  } = useEditorStore.getState();
  if (access === null) return "";
  const pooled = tabs.find((tab) => access.keepaliveEditor(tab.id) === editor);
  if (pooled !== undefined) return pooled.filePath;
  if (access.editor !== editor) return "";
  const loaded = loadedTabId();
  if (loaded === null || access.keepaliveEditor(loaded) !== null)
    return undefined;
  // A document at or over the keep-alive threshold loads into an editor of its own, acquired before
  // the load is flagged (`load-tab-content.ts`), so the shared editor is the target only without one.
  if (
    activeTabId !== null &&
    activeTabId !== loaded &&
    isTabLoading(activeTabId) &&
    access.keepaliveEditor(activeTabId) === null
  ) {
    return undefined;
  }
  return tabs.find((tab) => tab.id === loaded)?.filePath;
}
