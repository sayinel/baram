// §286/§298 The active tab's surface, computed once — extracted from `App.tsx` so the
// answer can be asserted and consumed by anything that needs it (StatusBar, retention,
// render) without pulling in App itself.
//
// ‼️ Before this, "what is the active tab showing" was answered three times in `App.tsx`
// by three hand-written chains that had to be kept in lockstep by a human: the StatusBar
// mode ternary, the `isMarkdownSurfaceActive` negation (whose own comment said its clauses
// "must exactly match the last else of the ternary below"), and the top-level render
// ternary. A chain gets a new branch and the other two don't — silently, because nothing
// forces the edit. This function is the one place that decides; the three call sites in
// `App.tsx` now differ only in how they map a `SurfaceKind` to what they each need.
import type { PluginFileViewer } from "../../plugins/plugin-ui-store";
import type { EditorTab } from "../../stores/editor/editor";

import { matchFileViewer } from "../../plugins/plugin-ui-store";
import { isFileTab, isGraphTab, isPluginTab } from "../../stores/editor/editor";
import {
  isHtmlFile,
  isImageFile,
  isMarkdownFile,
  isPdfFile,
} from "../file-type";

export interface ResolveSurfaceKindInput {
  /**
   * The active tab's id, separately from `tab` (the tab `App` resolved for it). Almost
   * always redundant with `tab !== undefined` — except for the one state that motivates
   * keeping it as its own field: `activeTabId` set to an id no open tab currently has (a
   * stale tab-switcher selection racing a concurrent close, for one). The three original
   * chains all gated home/empty on this id, not on whether the lookup succeeded, and a
   * dangling id fell through the SAME "markdown" doors as a normal tab; matching that
   * exactly — rather than reclassifying it as "empty" — is what this field is for.
   */
  activeTabId: null | string;
  /** Plugin-registered "viewer" extension point (§69) — App's `fileViewers`. */
  fileViewers: PluginFileViewer[];
  /**
   * §5.1 Is the active tab showing raw source instead of a rendered preview? Applies to
   * both HTML and plugin-previewed text files (SVG etc.) — App's `htmlSourceTabs`, keyed by
   * the active tab id.
   */
  isHtmlSourceView: boolean;
  /** §5.1 Markdown source-mode toggle for the active tab — `useSourceMode().isSourceMode`. */
  isSourceMode: boolean;
  /**
   * Vault root path, or null when no vault is open. Only distinguishes "home" from "empty"
   * — every other branch ignores it, since a home/empty split is a vault-level question, not
   * a tab-surface one.
   */
  rootPath: null | string;
  tab: EditorTab | undefined;
}

/**
 * Every surface the editor area can show for the active tab.
 *
 * "home" vs "empty" are both "no active tab" — they differ only in whether a vault is open
 * (`rootPath`), which is why `resolveSurfaceKind` takes it as an input instead of a caller
 * re-deriving that split on the side after the fact.
 */
export type SurfaceKind =
  | "empty"
  | "graph"
  | "home"
  | "image"
  | "markdown"
  | "pdf"
  | "plugin"
  | "preview"
  | "source";

/**
 * Which surface the active tab shows, in the same priority order the original three chains
 * used (read top to bottom — a tab is classified by the FIRST matching rule):
 *
 * no active tab id → home/empty → graph → plugin (detail tab) → pdf → image → preview
 * (HTML or a plugin-viewer-claimed text file, not currently showing source) → source
 * (any other non-markdown file, OR a markdown file toggled to source mode) → markdown.
 *
 * ‼️ A dangling `activeTabId` (set, but no open tab has it) or a tab whose `type` matches
 * none of "file"/"graph"/"plugin" (there is no such kind today) both take the SAME
 * "isSourceMode ? source : markdown" door a normal tab without a resolved file path would.
 * That reproduces what the three original chains actually did — `activeTabFilePath` was
 * null in both cases, so pdf/image/preview/code all read false — even though "assume
 * markdown for a tab kind that does not exist yet" is the direction `editorSurfaceBlockReason`
 * (`./active-tab.ts`) had to be corrected away from once already. It is kept here anyway
 * because unlike that call site, changing it would be a behavior change this extraction is
 * not supposed to make, for a state that has not been shown to be unreachable.
 */
export function resolveSurfaceKind(
  input: ResolveSurfaceKindInput,
): SurfaceKind {
  const {
    activeTabId,
    fileViewers,
    isHtmlSourceView,
    isSourceMode,
    rootPath,
    tab,
  } = input;

  if (!activeTabId) return rootPath ? "empty" : "home";
  if (isGraphTab(tab)) return "graph";
  if (isPluginTab(tab)) return "plugin";
  if (!isFileTab(tab)) return isSourceMode ? "source" : "markdown";

  const { filePath } = tab;
  if (isPdfFile(filePath)) return "pdf";
  if (isImageFile(filePath)) return "image";

  // ‼️ `isMarkdownFile("")` is true (untitled → markdown), so an untitled tab takes neither
  // of the next two branches and lands on "markdown"/"source" below like any other .md file.
  const isNonMarkdownFile = !isMarkdownFile(filePath);
  const pluginViewer = matchFileViewer(fileViewers, filePath);
  const isPreview =
    (isHtmlFile(filePath) || (!!pluginViewer && isNonMarkdownFile)) &&
    !isHtmlSourceView;
  if (isPreview) return "preview";

  if (isNonMarkdownFile || isSourceMode) return "source";
  return "markdown";
}
