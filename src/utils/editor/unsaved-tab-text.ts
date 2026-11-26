// §313 A tab with unsaved edits that is not installed in the active editor writes, on its next save,
// the document it holds (`saveSource` in save-still-current.ts) — not what is on disk. A change for
// its file made on the disk instead is taken back off by that save. A task toggled from the task
// panel was: the router sent such a tab to the disk, the line reached the disk and the tab's text
// but not its document, and since §3.6 (#1017) the auto-save writes a tab it left within its delay
// even in the background. So the change goes where that save reads, and the save carries it to the
// disk with the tab's edits.
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import {
  applyToDocumentSurface,
  liveViewOf,
  locateOpenTabSurface,
} from "./open-tab-surface";
import { contentPatch } from "./patch-editor-content";
import { isTabLoading } from "./programmatic-update";
import { serializeEditorState } from "./serialize-live-doc";

/** A tab's text as its next save reads it, and the way to put a new text there. */
export interface UnsavedTabText {
  /**
   * Puts `content` where `text` was read, and marks the tab dirty if that changed anything. Call it
   * in the same synchronous run as `unsavedTabText`, with no `await` between: in between, the tab may
   * come back, be left, lose its keep-alive editor, or take another write, and `text` is then not
   * what is there. `false` when `content` differs from `text` but the document would not change —
   * it parses to the same nodes — so the tab does not hold it.
   */
  land: (content: string) => boolean;
  text: string;
}

/**
 * Where the next save of `tabId` reads its text, read now. `textKey` is the key of the tab's text in
 * `openFiles`. It follows `locateOpenTabSurface`, and refuses where `saveSource` refuses to save —
 * a change put where no save reads it would be lost. `null` when:
 * - the tab is closed, or now shows another file than `textKey` (renamed or moved);
 * - no surface access is registered (a file window, a test): the tab's document objects cannot be
 *   seen, so its text is not known to be what it holds. `saveSource` then saves only a tab held by
 *   the editor it is given;
 * - it is in source mode — its text is the buffer, where the router sends it (`resolveTaskWriteTarget`);
 * - it is still loading: what it shows is being filled from the text it started with;
 * - only its text is to be trusted (flagged stale, an incomplete keep-alive entry, or no document
 *   object at all, such as a keep-alive editor evicted for another large tab or a tab-switch cache
 *   cleared by a content reload) and the tab is the active one: its install is pending or running and
 *   carries the text from before, so a change made to the text now would not be in the document it
 *   installs. A background tab parses the text when it comes back;
 * - its cached document and its text say different things — a write went to the disk and the text
 *   while the tab went dirty (see `saveSource`'s `cache` case). Rewriting the text from the cache would
 *   take that write back out, and the tab's next save would take it off the disk;
 * - it has no text.
 *
 * A document — the tab-switch cache, a keep-alive editor, the shared editor still holding the tab —
 * takes the change as one transaction that replaces the top-level blocks from the first that differs
 * to the last (`contentPatch`). Blocks that do not parse back to the same node (a table's measured
 * column widths, a mark the cursor has revealed) count as differing, so the range can reach past the
 * changed line; undo entries for edits inside it are dropped, as with `patchEditorContent`.
 * `applyToDocumentSurface` lands it by surface: a cache entry is replaced and the text and dirty flag
 * follow; a hidden keep-alive editor is dispatched to and the text and dirty flag follow; the editor
 * showing the active tab is dispatched to, and the auto-save hears it; the shared view of a tab on
 * its way out takes the new state without an event, and its cache entry, text and dirty flag follow.
 * A cached state is read again when its tab comes back (`restoreCachedState`), so a restore already
 * scheduled installs the change too. The transaction stays out of the undo history: the task panel
 * records the line it wrote (`patchTask`), and an undo in the editor would take the line back without
 * the panel knowing. It carries no `CONTENT_SYNC_META`, which would fold it into the saved baseline
 * (`use-auto-save.ts`) — it is not saved yet.
 */
export function unsavedTabText(
  tabId: string,
  textKey: string,
): null | UnsavedTabText {
  const { activeTabId, documentSurfaceAccess, tabs } =
    useEditorStore.getState();
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab || (tab.filePath || tab.id) !== textKey) return null;
  if (documentSurfaceAccess === null || isTabLoading(tabId)) return null;
  const surface = locateOpenTabSurface(tabId, liveViewOf(tabId));
  const stored = useFileStore.getState().openFiles.get(textKey);
  switch (surface.kind) {
    case "source":
      return null;
    case "text": {
      if (tabId === activeTabId || stored === undefined) return null;
      return {
        land: (content) => {
          if (content === stored) return true;
          useFileStore.getState().setFileContent(textKey, content);
          useEditorStore.getState().markDirty(tabId, true);
          return true;
        },
        text: stored,
      };
    }
    default: {
      const text = serializeEditorState(
        surface.kind === "cache"
          ? surface.state
          : surface.kind === "keepalive"
            ? surface.editor.state
            : surface.view.state,
      );
      if (surface.kind === "cache" && stored !== text) return null;
      return {
        land: (content) => {
          if (content === text) return true;
          const landed = applyToDocumentSurface(
            surface,
            { tabId, textKey },
            (current) =>
              contentPatch(current, content)?.setMeta("addToHistory", false) ??
              null,
          );
          // `applyToDocumentSurface` marks a background tab, and the auto-save marks the active one
          // when it hears the dispatch. Marked here as well so the mark rests on neither — the tab
          // may have been saved while the write waited for its line. `markDirty` keeps an unchanged
          // flag as it is.
          if (landed) useEditorStore.getState().markDirty(tabId, true);
          return landed;
        },
        text,
      };
    }
  }
}
