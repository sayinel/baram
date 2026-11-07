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
import { loadedTabId } from "./programmatic-update";
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
   * disk baseline (the conflict modal's 3-way base, the auto-reload's divergence check). False for a
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
 * For a save that serialized `editor`'s document for `tabId` and wrote it as `written`. `docAtWrite`
 * is the document it serialized, or `null` when there is none to compare with (a document still
 * being filled in pieces when the write began).
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
  written: string,
): SaveOutcome {
  const held = heldDocument(editor, tabId);
  if (held === null) return { cacheIsDisk: false, unchanged: false };
  const unchanged =
    held.doc === docAtWrite ||
    (docAtWrite !== null && held.doc.eq(docAtWrite)) ||
    held.serialize() === written;
  return {
    baseline: unchanged ? held.doc : undefined,
    cacheIsDisk: unchanged || held.live,
    unchanged,
  };
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
