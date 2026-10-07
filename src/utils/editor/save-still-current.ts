// §3.5 Did a save write what the tab still holds? (#798)
//
// A save serializes, awaits the write, and then records the result: the cache, the dirty
// flags, the dirty baseline. Anything the user typed while the write was pending is not
// in the file, so recording "saved" afterwards would mark the tab clean over an edit that
// never reached disk — the close then drops it without a prompt, and a failed follow-up
// write leaves the tab falsely clean. Each save site asks this before that bookkeeping.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

import { useEditorStore } from "../../stores/editor/editor";
import { serializeLiveDoc } from "./serialize-live-doc";

/**
 * Does the live editor still hold, for `tabId`, the document a save wrote as `written`?
 * The same doc object is the fast answer; a changed doc that serializes to the same text
 * (an edit typed and undone while the write ran) also counts. The editor answers only for
 * the active tab — after a switch it shows another document.
 */
export function editorStillHolds(
  editor: Editor,
  tabId: string,
  docAtWrite: PMNode,
  written: string,
): boolean {
  if (useEditorStore.getState().activeTabId !== tabId) return false;
  if (editor.state.doc === docAtWrite) return true;
  return serializeLiveDoc(editor) === written;
}
