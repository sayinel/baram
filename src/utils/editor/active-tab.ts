// Pure derivations about the ACTIVE tab, extracted from `App.tsx` so they can be asserted.
//
// ‼️ Why they left the component: no test imports `App`, so the two most consequential
// derivations in it were unverified — the §260 Phase 4b block that stops a plugin reading a
// document the active tab does not hold, and the id that selects the plugin detail branch. A
// mutation to either was invisible to the whole suite.
import type { EditorTab } from "../../stores/editor/editor";

import { isFileTab, isPluginTab } from "../../stores/editor/editor";

/**
 * The plugin whose detail tab is active, or null.
 *
 * A string rather than a boolean: the id both selects the render branch and is the payload
 * the detail host needs, and a primitive keeps the store selector stable without `useShallow`.
 */
export function activePluginIdOf(
  tabs: EditorTab[],
  activeTabId: null | string,
): null | string {
  const tab = tabs.find((t) => t.id === activeTabId);
  return isPluginTab(tab) ? (tab?.pluginId ?? null) : null;
}

/**
 * Why the plugin editor API must refuse reads and writes right now, or null when the Tiptap
 * document IS what the active tab holds.
 *
 * §260 Phase 4b security review (LOW-3). An editor instance stays mounted in every one of
 * these states, so "an editor exists" is not the same question: in Source Mode the user edits
 * CodeMirror while the Tiptap doc keeps its pre-toggle content, and `handleSave` writes
 * `sourceContentRef` for a source-mode or non-markdown tab. Without this a plugin reads a
 * stale document and its writes are dropped on the next toggle or save — silent data loss,
 * from an API that reported success.
 *
 * ‼️ The first clause asks "is this a file tab?", NOT "is it one of the tab kinds I listed".
 * It was `isGraphTabActive || !!activePluginId || isPdfTab`, which meant a fifth tab kind
 * satisfied none of the clauses, fell through `isSourceMode`/`isCodeFile` (both false when the
 * active tab has no path) and reached the `null` fallback — DEFAULTING A NEW TAB KIND TO
 * "a plugin may read the editor". This is the same inversion the save and source-mode guards
 * got; it was missed here, at the site with the most at stake.
 */
export function editorSurfaceBlockReason(input: {
  activeTab: EditorTab | undefined;
  isCodeFile: boolean;
  isPdfTab: boolean;
  isSourceMode: boolean;
}): null | string {
  if (!isFileTab(input.activeTab) || input.isPdfTab) {
    return "no document is open in the editor";
  }
  if (input.isSourceMode) {
    return "the document is open in source mode, so the editor is not its content";
  }
  if (input.isCodeFile) return "the active tab is not a markdown document";
  return null;
}
