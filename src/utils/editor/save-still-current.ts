// §3.5 Did a save write what the tab still holds? (#798)
//
// A save serializes, awaits the write, and then records the result: the cache, the dirty
// flags, the dirty baseline. Anything the user typed while the write was pending is not
// in the file, so recording "saved" afterwards would mark the tab clean over an edit that
// never reached disk — the close then drops it without a prompt, and a failed follow-up
// write leaves the tab falsely clean. Each save site asks these before that bookkeeping.
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { liveViewOf, locateOpenTabSurface } from "./open-tab-surface";
import {
  editorHoldsWholeDocument,
  isTabLoading,
  loadedTabId,
} from "./programmatic-update";
import { serializeEditorState, serializeLiveDoc } from "./serialize-live-doc";

/** What a save finds once its write has ended. */
export interface SaveOutcome {
  /**
   * For a document save found unchanged: the document the tab holds now, which becomes the dirty
   * baseline. It is the written document itself, or one that serializes to the same text — a change
   * the dirty tracking folds into the baseline (a table's measured column widths, a syntax reveal)
   * landed during the write, and the baseline keeps it as that folding would have.
   */
  baseline?: PMNode;
  /**
   * Whether the tab's `openFiles` entry stands for the file on disk, so the save sets it to what it
   * wrote. True while the tab's text is somewhere else that is live — its editor, or the source
   * buffer of the active tab — even if that text moved on during the write: the entry is then the
   * disk baseline (the auto-reload's divergence check). False for a
   * tab left while the write ran: the tab switch copied its text into the entry on the way out
   * (`saveOutgoingTab`), and the close guard's background save writes that entry, so replacing it
   * with the older written text would lose what was typed. When false, the entry is not touched,
   * and a save that moves the tab to a new key carries the entry over as it is.
   */
  cacheIsDisk: boolean;
  /** Whether the tab still holds exactly what was written — only then is it recorded saved. */
  unchanged: boolean;
}

/**
 * Where a save of a tab reads its text now (`saveSource`): its document, with the editor to pass
 * `documentSaveOutcome` once the write has ended — the editor holding the document, or the shared
 * editor for a cached state, where a returning tab is installed — or its text in `openFiles`, when
 * no document of the tab may be trusted.
 */
export type SaveSource =
  | { doc: PMNode; judge: Editor; kind: "document"; serialize: () => string }
  | { kind: "text"; text: string };

/**
 * For a save that read the buffer: `holdsNow` is the buffer read again after the write. Buffers are
 * kept per tab, so the buffer is the tab's text whether or not the tab is active; what the tab
 * being active decides is only what the cache entry stands for (see `SaveOutcome.cacheIsDisk`).
 */
export function bufferSaveOutcome(
  tabId: string,
  holdsNow: string,
  written: string,
): SaveOutcome {
  const unchanged = holdsNow === written;
  return {
    cacheIsDisk: unchanged || useEditorStore.getState().activeTabId === tabId,
    unchanged,
  };
}

/**
 * For a save of `tabId`'s document from `editor`. `docAtWrite` is the document the written text came
 * from (`null` when it came from no document — `textSaveOutcome`), and `written` is that text as the
 * serializer puts it — a save that serialized the document
 * passes what it wrote; the save on the way back from source mode wrote the buffer as typed, so it
 * passes the serialization of the document it installed, computed only if it is needed.
 *
 * "Still holds" is asked of where the tab's document is now, not of whether the tab is active. A
 * keep-alive editor keeps its tab's document while that tab is in the background, and the shared
 * editor holds a tab from its install (`loadedTabId`, which flips only once the content is in,
 * unlike the active tab id) until the next install, after which the tab's state is in the
 * tab-switch cache — the reading `viewHoldsTab` in `open-tab-surface.ts` also uses. With no surface
 * access registered (a file window, a test), only the shared-editor reading applies.
 *
 * The same document, or one `eq` to it, is unchanged without serializing — `eq` returns at a node
 * the two documents share, so it stops early when the document was not touched. A document that
 * moved on is serialized again and compared with what was written: transactions the dirty tracking
 * does not count as edits (`use-auto-save.ts` — a table's column widths measured on install, a
 * syntax reveal on a caret move, a content sync, the journal caret) change the document without
 * changing its text and schedule no save, so counting them as edits would leave the tab unsaved
 * until the user next typed. That costs one more serialization after a write a keystroke landed in.
 */
export function documentSaveOutcome(
  editor: Editor,
  tabId: string,
  docAtWrite: null | PMNode,
  written: (() => string) | string,
): SaveOutcome {
  const held = heldDocument(editor, tabId);
  if (held === null) return { cacheIsDisk: false, unchanged: false };
  const unchanged =
    (docAtWrite !== null &&
      (held.doc === docAtWrite || held.doc.eq(docAtWrite))) ||
    held.serialize() === (typeof written === "string" ? written : written());
  return {
    baseline: unchanged ? held.doc : undefined,
    cacheIsDisk: unchanged || held.live,
    unchanged,
  };
}

/**
 * Where a save of `tabId` reads the tab's text now, or `null` when it may write none. `textKey` is
 * the key of the tab's text in `openFiles`.
 *
 * The answer follows `locateOpenTabSurface`, which is where a tab's document is whether or not the
 * tab is active (§3.6): the editor that holds it (the shared editor while the tab is installed in it,
 * or its keep-alive editor), else the tab-switch cache, else — for a document not to be trusted
 * (flagged stale, an incomplete keep-alive entry) or none left (a keep-alive editor evicted for
 * another large tab puts its text there) — the `openFiles` text, which is also what the close guard's
 * background save writes for such a tab (`backgroundText`). The shared editor is read only for the tab
 * `loadedTabId` names, so a tab left during its save never writes the next tab's document.
 *
 * `null` for a tab in source mode, whose text is the source buffer; for a tab still loading, whose
 * editor holds only the first blocks — what is typed into them before the load ends marks nothing
 * dirty (`shouldSkipDirty`), so writing the text and recording it saved would drop that typing
 * without a prompt; for a cached document whose `openFiles` text says something else (see the
 * `cache` case); and with no text at all.
 *
 * With no surface access registered (a file window, a test), only `editor` holding the tab counts.
 */
export function saveSource(
  editor: Editor,
  tabId: string,
  textKey: string,
): null | SaveSource {
  const access = useEditorStore.getState().documentSurfaceAccess;
  if (access === null) {
    return editorHoldsWholeDocument(tabId) ? fromEditor(editor) : null;
  }
  if (isTabLoading(tabId)) return null;
  const surface = locateOpenTabSurface(tabId, liveViewOf(tabId));
  switch (surface.kind) {
    case "cache": {
      const text = serializeEditorState(surface.state);
      // The tab switch caches a tab's state with the same text in `openFiles` (`saveOutgoingTab`), and
      // so does a change landed in the cache (`applyToDocumentSurface`). The way back from source
      // mode caches the active tab's state alone (`use-source-mode.ts`), but that tab's document is
      // read from the editor holding it, and leaving it rewrites both. So text that differs from the
      // cache was written by something else, and the disk has that change. Each such writer checks
      // first that the tab is not dirty, so it reaches a dirty tab here only when the tab went dirty
      // between that check and the write. For a task written from the task panel the check is the
      // router, which sends a dirty tab's write to that tab's own document (`resolveTaskWriteTarget`,
      // §313); a write it sends to the disk splices its line into the text
      // (`syncOpenSurfacesAfterDiskWrite`). A capture appended on disk, an archive and an
      // auto-reload replace the whole text (`syncOpenSurfacesAfterFileRewrite`, `triggerAutoReload`)
      // after `assertNoUnsavedTab`, `findBlockingTab`, and the watcher's and the keep-alive resume's
      // `isDirty`; a forced reload marks the tab stale, which `locateOpenTabSurface` answers with
      // "text". Writing the cache would take the change back off the disk without a word, so the tab
      // stays dirty and the close guard asks about it.
      if (useFileStore.getState().openFiles.get(textKey) !== text) return null;
      return {
        doc: surface.state.doc,
        judge: access.editor,
        kind: "document",
        serialize: () => text,
      };
    }
    case "keepalive":
      return fromEditor(surface.editor);
    case "source":
      return null;
    case "text": {
      const text = useFileStore.getState().openFiles.get(textKey);
      return text === undefined ? null : { kind: "text", text };
    }
    case "view":
      // `liveViewOf` gave the keep-alive editor's view if there is one, else the shared editor's.
      return fromEditor(access.keepaliveEditor(tabId) ?? access.editor);
  }
}

/**
 * For a save that wrote a tab's `openFiles` text (`saveSource` answered `text`): judged by where the
 * tab's text is now. A document installed from that text while the write ran is what the tab holds
 * then, and is judged as a document save is; otherwise the text is compared, and is the disk only if
 * it did not move on — a newer text is the tab's, and replacing it would lose it.
 */
export function textSaveOutcome(
  editor: Editor,
  tabId: string,
  textKey: string,
  written: string,
): SaveOutcome {
  const now = saveSource(editor, tabId, textKey);
  if (now === null) return { cacheIsDisk: false, unchanged: false };
  if (now.kind === "document") {
    return documentSaveOutcome(now.judge, tabId, null, written);
  }
  const unchanged = now.text === written;
  return { cacheIsDisk: unchanged, unchanged };
}

/**
 * Whether the tab that saved is still open under the path it wrote (#798). A tab closed, renamed
 * or moved while the write ran no longer stands for that file, so the save records nothing for it
 * there — no mtime, no cache entry. Either would outlive the tab: the closed-tab release keys on
 * tab ids and has already run.
 */
export function tabStillShows(tabId: string, filePath: string): boolean {
  return useEditorStore
    .getState()
    .tabs.some((t) => t.id === tabId && t.filePath === filePath);
}

function fromEditor(editor: Editor): SaveSource {
  return {
    doc: editor.state.doc,
    judge: editor,
    kind: "document",
    serialize: () => serializeLiveDoc(editor),
  };
}

/** Where `tabId`'s document is, seen from `editor` (see `documentSaveOutcome`), or `null`. */
function heldDocument(
  editor: Editor,
  tabId: string,
): null | { doc: PMNode; live: boolean; serialize: () => string } {
  const access = useEditorStore.getState().documentSurfaceAccess;
  const live = {
    doc: editor.state.doc,
    live: true,
    serialize: () => serializeLiveDoc(editor),
  };
  const pooled = access?.keepaliveEditor(tabId) ?? null;
  if (pooled !== null) return pooled === editor ? live : null;
  if ((access === null || access.editor === editor) && loadedTabId() === tabId)
    return live;
  const cached = access?.editorStateCache.get(tabId);
  return cached
    ? {
        doc: cached.doc,
        live: false,
        serialize: () => serializeEditorState(cached),
      }
    : null;
}
