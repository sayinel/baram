// §5.5 Turning the column resize option off takes the widths the user set out of
// the open markdown tabs (spec 0075 D4, D6, D7). `open-tab-surface.ts` says where each
// tab's document is; this module says what happens to it there.
//
// Nothing here writes to disk. A dirty tab also holds edits the user has not saved,
// and a write would send those along unasked. A cleared tab is saved the way an
// edited one is: the active tab through the auto-save, a background tab through the
// close and quit guard.
import type { EditorTab } from "../../stores/editor/editor";
import type { EditorView } from "@tiptap/pm/view";

import { buildClearTableWidthsTransaction } from "../../extensions/nodes/plugins/table-col-resize";
import { stripTableWidthComments } from "../../pipeline/convert-table-colwidths";
import {
  isFileTab,
  type SourceBufferAccess,
  useEditorStore,
} from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { isMarkdownFile } from "../file-type";
import { logger } from "../logger";
import {
  applyToDocumentSurface,
  liveViewOf,
  locateOpenTabSurface,
} from "./open-tab-surface";
import { subscribeContentLoaded } from "./programmatic-update";

/** Clears the widths in every open markdown tab, each where its document is now. */
export function clearTableWidthsInOpenTabs(): void {
  for (const tab of useEditorStore.getState().tabs) {
    clearTabIsolated(tab, false);
  }
}

/**
 * The setting's toggle: sets the value, and clears on on → off. This is not a store
 * subscription because the settings store restores asynchronously and answers with
 * its default until then, so a saved `false` reads as an on → off change at every
 * start, and the widths would go without the user having touched anything.
 */
export function setTableColumnResizeFromUser(enabled: boolean): void {
  const settings = useSettingsStore.getState();
  const wasOn = settings.tableColumnResize;
  settings.setTableColumnResize(enabled);
  if (wasOn && !enabled) clearTableWidthsInOpenTabs();
}

/**
 * Tabs whose document was out of reach when the clear ran: only their text was
 * there, or nothing yet. A document may still be parsed from the text as it was
 * before the clear, so each is re-checked once, when a document is installed.
 *
 * The rewritten text can still hold a comment: `stripTableWidthComments` leaves one
 * on a list marker's line, which still gives the table after it widths when parsed,
 * and one between two non-blank lines with no table right after, which gives no
 * table widths. A re-check that reaches a document clears any widths it finds. One
 * that lands on the text again does not wait a second time, so such widths stay.
 *
 * A wait ends with its tab, whichever way the tab closes. Some `openTab` callers
 * build the tab id from the file path, so a file opened again can come back under
 * the closed tab's id, and a wait left standing would clear a file that D7 says
 * keeps its widths.
 */
const pendingClears = new Set<string>();
/** Set while `pendingClears` has anything in it. */
let stopWatchingTabs: (() => void) | null = null;

subscribeContentLoaded(drainPendingClear);

function addPendingClear(tabId: string): void {
  pendingClears.add(tabId);
  stopWatchingTabs ??= useEditorStore.subscribe((state, prev) => {
    if (state.tabs !== prev.tabs) dropWaitsOfClosedTabs(state.tabs);
  });
}

function clearSourceBuffer(
  tabId: string,
  textKey: string,
  access: null | SourceBufferAccess,
): void {
  if (!access) {
    logger.warn(
      `[tableWidths] ${textKey}: the source buffer is not reachable, so its width comments stay`,
    );
    return;
  }
  const buffer = access.getSourceBuffer(tabId);
  const next = stripTableWidthComments(buffer);
  if (next === buffer) return;
  access.setSourceBuffer(tabId, next);
  useEditorStore.getState().markSourceEdited(tabId, true);
}

/**
 * Locates and applies in one synchronous run: the `cache` surface holds the state
 * captured when it was located.
 */
function clearTab(tab: EditorTab, draining: boolean): void {
  if (!isFileTab(tab) || !isMarkdownFile(tab.filePath)) return;
  const tabId = tab.id;
  const textKey = tab.filePath || tabId;
  const surface = locateOpenTabSurface(tabId, viewToClearThrough(tabId));
  switch (surface.kind) {
    case "source":
      clearSourceBuffer(tabId, textKey, surface.access);
      return;
    case "text":
      clearText(tabId, textKey);
      if (!draining) addPendingClear(tabId);
      return;
    default:
      applyToDocumentSurface(
        surface,
        { tabId, textKey },
        buildClearTableWidthsTransaction,
      );
  }
}

/**
 * One tab's failure stays that tab's. When the user turns the option off the setting
 * has already changed and the run is not repeated, so the tabs after this one must
 * still be cleared. In the drain, a throw would stop the remaining listeners of
 * `markContentLoaded`. The tab is marked dirty as `saveOutgoingTab` does when it
 * cannot serialize: a cache that was cleared while its text kept the comment must
 * not look clean.
 */
function clearTabIsolated(tab: EditorTab, draining: boolean): void {
  try {
    clearTab(tab, draining);
  } catch (err) {
    logger.error(
      `[tableWidths] ${tab.filePath || tab.id}: could not clear the widths`,
      err,
    );
    useEditorStore.getState().markDirty(tab.id, true);
  }
}

function clearText(tabId: string, textKey: string): void {
  const content = useFileStore.getState().openFiles.get(textKey);
  if (content === undefined) return;
  const next = stripTableWidthComments(content);
  if (next === content) return;
  useFileStore.getState().setFileContent(textKey, next);
  useEditorStore.getState().markDirty(tabId, true);
}

function drainPendingClear(tabId: string): void {
  if (!pendingClears.delete(tabId)) return;
  releaseTabWatchIfIdle();
  if (useSettingsStore.getState().tableColumnResize) return;
  const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
  if (tab) clearTabIsolated(tab, true);
}

function dropWaitsOfClosedTabs(tabs: readonly EditorTab[]): void {
  const openTabIds = new Set(tabs.map((tab) => tab.id));
  for (const tabId of pendingClears) {
    if (!openTabIds.has(tabId)) pendingClears.delete(tabId);
  }
  releaseTabWatchIfIdle();
}

function releaseTabWatchIfIdle(): void {
  if (pendingClears.size > 0) return;
  stopWatchingTabs?.();
  stopWatchingTabs = null;
}

/**
 * The view to clear a tab through. The shared view only for the active tab:
 * `loadedTabId` records the last announced install, and some installs replace the
 * shared document without touching it (`use-editor-effects.ts`, even for an active
 * tab that is not markdown), so for a tab not on screen that view may hold a different
 * document, which the clear would file under this tab. Such a tab goes to its cache,
 * where `saveOutgoingTab` put it as it left, and then to its text. A pooled editor
 * owns its document, and `locateOpenTabSurface` finds it without being given a view.
 *
 * The accepted limit: a toggle in the instant between the active tab flipping and
 * `saveOutgoingTab` can leave that tab's widths in place, because that save caches
 * the view's state over the cleared one. Nothing is written to another file.
 */
function viewToClearThrough(tabId: string): EditorView | undefined {
  return tabId === useEditorStore.getState().activeTabId
    ? liveViewOf(tabId)
    : undefined;
}
