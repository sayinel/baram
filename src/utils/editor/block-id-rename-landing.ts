// §30a issue 594 — a block ID rename the backend has committed lands in the
// document that defines the block, wherever that document is right now.
//
// `rename_block_id` rewrites `((file#^old))` in every OTHER file and leaves
// the defining document to the editor, which owns it. The editor commits its
// half only after the backend has said yes — and by then the user may have
// switched or closed the tab, entered source mode, or still be loading a large
// file. The document is then not (only) in the view that asked: it is a
// source-mode buffer, a live keep-alive editor, a cached EditorState, the
// `openFiles` snapshot, or only the file on disk. This module knows every one
// of those places, knows which of them is the AUTHORITY at the moment, and
// puts the rename there. A toast is a receipt, not a destination.
//
// Authority, in order: a source-mode tab's buffer (its ProseMirror document is
// still alive but stale); the text (`openFiles`) for a tab whose document
// objects are not to be trusted — flagged stale, still loading, or an
// incomplete keep-alive entry; then the document objects themselves.
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { readFile, updateFileIndex, writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { logger } from "../logger";
import {
  refersToThisDocument,
  renameBlockIdInMarkdown,
} from "./block-id-rename-markdown";
import {
  isTabLoading,
  loadedTabId,
  subscribeContentLoaded,
} from "./programmatic-update";
import { serializeEditorState } from "./serialize-live-doc";

export interface CommittedBlockIdRename {
  filePath: string;
  newId: string;
  oldId: string;
  /** The tab whose editor the rename was committed from. */
  tabId: string;
}

/**
 * Where the rename landed. `dropped`: the block `^oldId` is nowhere the
 * document could be — deleted or renamed again meanwhile, or the disk write
 * failed — and the caller tells the user. `pending`: the document is between
 * places; the queue is drained when content is installed. `content`: the text
 * changed and the queue re-checks the document once it is installed.
 */
export type Landing =
  | "cache"
  | "content"
  | "disk"
  | "dropped"
  | "keepalive"
  | "pending"
  | "source"
  | "view";

interface InFlight {
  chain: Promise<unknown>;
  newId: string;
  oldId: string;
}

/**
 * A save must not capture a document while a rename it will have to carry is
 * still in flight: `handleSave` serializes and then awaits the write, and a
 * rename landing in between is written by nothing — the tab may close on that
 * write. Save paths await the tab's renames here first.
 */
export function awaitBlockIdRenames(tabId?: string): Promise<void> {
  const chains = (
    tabId === undefined
      ? [...inFlight.values()].flat()
      : (inFlight.get(tabId) ?? [])
  ).map((entry) => entry.chain);
  return Promise.all(chains).then(() => undefined);
}

/** Whether any rename is in flight for the tab (or at all, without a tab). */
export function hasBlockIdRenamesInFlight(tabId?: string): boolean {
  return tabId === undefined
    ? inFlight.size > 0
    : (inFlight.get(tabId)?.length ?? 0) > 0;
}

/**
 * Whether a rename touching `blockId` (as its old or its new ID) is still in
 * flight for the tab. Two overlapping renames of one block would each read
 * the same backlinks and rewrite the same files in an order nobody controls;
 * the second waits for the first to settle.
 */
export function isBlockIdRenameInFlight(
  tabId: string,
  blockId: string,
): boolean {
  return (inFlight.get(tabId) ?? []).some(
    (entry) => entry.oldId === blockId || entry.newId === blockId,
  );
}

/**
 * The transaction that renames the block and this document's own references
 * to it (§30a-2). Out of the undo history: the backend has already renamed the
 * references in other files, and an Undo that put the old ID back here would
 * leave them pointing at an ID this document no longer has — the next save
 * would make that permanent (the same reasoning as `patchEditorContent`,
 * §313). Renaming the ID again is the way back. `null` when the block is not
 * in the document.
 */
export function buildBlockIdRenameTransaction(
  state: EditorState,
  op: Pick<CommittedBlockIdRename, "filePath" | "newId" | "oldId">,
): null | Transaction {
  const pos = findBlockPosById(state.doc, op.oldId);
  if (pos === null) return null;
  const node = state.doc.nodeAt(pos);
  if (!node) return null;
  const { tr } = state;
  tr.setMeta("addToHistory", false);
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: op.newId });
  state.doc.descendants((child, childPos) => {
    if (
      (child.type.name === "blockReference" ||
        child.type.name === "blockEmbed") &&
      child.attrs.blockId === op.oldId &&
      refersToThisDocument(String(child.attrs.target ?? ""), op.filePath)
    ) {
      tr.setNodeMarkup(childPos, undefined, {
        ...child.attrs,
        blockId: op.newId,
      });
    }
    return true;
  });
  return tr;
}

/**
 * Called when a tab's content has been installed in an editor (every load
 * path passes `markContentLoaded`): renames that arrived while the document
 * was between places, or that only reached its text, are re-landed against the
 * real document. Idempotent — a document that already says `newId` has no
 * `oldId` block, and the entry is dropped quietly.
 */
export function drainPendingBlockIdRenames(tabId: string): void {
  const ops = pending.get(tabId);
  if (!ops) return;
  pending.delete(tabId);
  const access = useEditorStore.getState().documentSurfaceAccess;
  for (const op of ops) {
    const editor =
      access?.keepaliveEditor(tabId) ??
      (loadedTabId() === tabId ? access?.editor : null);
    void land(
      op,
      editor && !editor.isDestroyed ? editor.view : undefined,
      true,
    );
  }
}

/** Position of the paragraph/heading carrying `blockId`, or null. */
export function findBlockPosById(doc: PmNode, blockId: string): null | number {
  let found: null | number = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (
      (node.type.name === "paragraph" || node.type.name === "heading") &&
      node.attrs.blockId === blockId
    ) {
      found = pos;
      return false;
    }
    return true;
  });
  return found;
}

/**
 * Put a committed rename into its document. `view` is the editor the edit was
 * made in, if the caller still has it. Synchronous for every destination but
 * the disk; the promise settles when that write (and its index refresh) has.
 */
export async function landCommittedBlockIdRename(
  op: CommittedBlockIdRename,
  view?: EditorView,
): Promise<Landing> {
  return land(op, view, false);
}

/** Forget the queued renames of tabs that are no longer open. */
export function prunePendingBlockIdRenames(
  openTabIds: ReadonlySet<string>,
): void {
  for (const tabId of pending.keys()) {
    if (!openTabIds.has(tabId)) pending.delete(tabId);
  }
}

/**
 * Register a rename's whole chain — IPC, landing, cache refresh — as in
 * flight for `tabId`, for `awaitBlockIdRenames`. The chain must never reject
 * (the commit path owns its errors); it is forgotten once settled.
 */
export function trackBlockIdRename(
  tabId: string,
  ids: Pick<CommittedBlockIdRename, "newId" | "oldId">,
  chain: Promise<unknown>,
): void {
  const entry: InFlight = { chain, newId: ids.newId, oldId: ids.oldId };
  const entries = inFlight.get(tabId) ?? [];
  entries.push(entry);
  inFlight.set(tabId, entries);
  void chain.finally(() => {
    const remaining = (inFlight.get(tabId) ?? []).filter((e) => e !== entry);
    if (remaining.length === 0) inFlight.delete(tabId);
    else inFlight.set(tabId, remaining);
  });
}

const inFlight = new Map<string, InFlight[]>();
const pending = new Map<string, CommittedBlockIdRename[]>();

subscribeContentLoaded(drainPendingBlockIdRenames);

function dropped(op: CommittedBlockIdRename, why: string): "dropped" {
  logger.warn(
    `[blockId] ${op.filePath}: other files now say ^${op.newId}, but ${why} (^${op.oldId})`,
  );
  return "dropped";
}

function enqueue(op: CommittedBlockIdRename): void {
  const ops = pending.get(op.tabId) ?? [];
  ops.push(op);
  pending.set(op.tabId, ops);
}

async function land(
  op: CommittedBlockIdRename,
  view: EditorView | undefined,
  draining: boolean,
): Promise<Landing> {
  const editorStore = useEditorStore.getState();
  const { documentSurfaceAccess: access, sourceBufferAccess } = editorStore;
  const tab = editorStore.tabs.find((t) => t.id === op.tabId);

  // The tab is gone: only the file on disk is left to hold the definition.
  if (!tab) return landOnDisk(op);

  // 1. A source-mode tab: its buffer is the authoritative text. Its
  //    ProseMirror document is still alive in the shared view — and stale;
  //    a transaction there would be lost when the buffer is parsed back, and
  //    would wake the auto-save for a document that is not the truth.
  if (editorStore.sourceModeTabs.includes(op.tabId)) {
    if (!sourceBufferAccess) {
      if (draining) return dropped(op, "the source buffer is not reachable");
      enqueue(op);
      return "pending";
    }
    const buffer = sourceBufferAccess.getSourceBuffer(op.tabId);
    const next = renameBlockIdInMarkdown(
      buffer,
      op.filePath,
      op.oldId,
      op.newId,
    );
    if (next === buffer)
      return dropped(op, "the source buffer has no such block");
    sourceBufferAccess.setSourceBuffer(op.tabId, next);
    editorStore.markSourceEdited(op.tabId, true);
    return "source";
  }

  // 2. Document objects that must not be trusted: a tab flagged stale (its
  //    file changed while it was in the background; the cache is dropped on
  //    return and the text re-parsed), a load still appending blocks, or a
  //    keep-alive entry the load never completed. The text is the authority;
  //    a document object gets the rename once one is installed for real.
  const pooled = access?.keepaliveEditor(op.tabId) ?? null;
  const textOnly =
    editorStore.staleContentTabs.includes(op.tabId) ||
    isTabLoading(op.tabId) ||
    (pooled !== null &&
      access !== null &&
      !access.isKeepaliveComplete(op.tabId));
  if (textOnly) return landInText(op, draining);

  // 3. The view the edit was made in, if it still holds this tab's document.
  //    A keep-alive view owns its document; the shared view holds this tab's
  //    while the tab is installed in it. Once the tab is on its way OUT — the
  //    active tab has moved on, the install of the next has not happened —
  //    the document is still here, but a dispatched transaction would be
  //    attributed by the auto-save to the incoming tab (it reads the active
  //    tab at event time) and could write this document to that tab's file.
  //    So the state is updated WITHOUT an event: `saveOutgoingTab` then caches
  //    and serializes the renamed state, and the cache entry and text that
  //    may already exist are refreshed here as well.
  if (view && viewHoldsTab(view, op.tabId)) {
    const tr = buildBlockIdRenameTransaction(view.state, op);
    if (!tr) return dropped(op, "the document in the editor has no such block");
    const keepalive = isKeepaliveView(view);
    if (keepalive || editorStore.activeTabId === op.tabId) {
      view.dispatch(tr);
      // A hidden keep-alive editor's update reaches no auto-save.
      if (keepalive && editorStore.activeTabId !== op.tabId) {
        publishBackgroundChange(op, view.state);
      }
      return "view";
    }
    view.updateState(view.state.apply(tr));
    if (access?.editorStateCache.has(op.tabId)) {
      access.editorStateCache.set(op.tabId, view.state);
    }
    publishBackgroundChange(op, view.state);
    return "view";
  }

  // 4. A large document's keep-alive editor: live, but hidden while its tab is
  //    in the background, so nothing else marks it dirty for us.
  if (pooled && !pooled.isDestroyed) {
    const tr = buildBlockIdRenameTransaction(pooled.state, op);
    if (!tr) return dropped(op, "the keep-alive editor has no such block");
    pooled.view.dispatch(tr);
    publishBackgroundChange(op, pooled.state);
    return "keepalive";
  }

  // 5. An ordinary background tab: its document is a cached EditorState (undo
  //    history included), restored when the tab comes back.
  const cached = access?.editorStateCache.get(op.tabId);
  if (access && cached) {
    const tr = buildBlockIdRenameTransaction(cached, op);
    if (!tr) return dropped(op, "the cached document has no such block");
    const next = cached.apply(tr);
    access.editorStateCache.set(op.tabId, next);
    publishBackgroundChange(op, next);
    return "cache";
  }

  // 6. No document object anywhere — only text, or nothing yet.
  return landInText(op, draining);
}

/**
 * Rename the text in `openFiles` — what the next load parses — and, unless
 * this is already the re-check, queue a re-check against the document once
 * one is installed. Without any text either, only the queue is left.
 */
function landInText(op: CommittedBlockIdRename, draining: boolean): Landing {
  const content = useFileStore.getState().openFiles.get(op.filePath);
  if (content === undefined) {
    if (draining) return dropped(op, "the document never became available");
    enqueue(op);
    return "pending";
  }
  const next = renameBlockIdInMarkdown(
    content,
    op.filePath,
    op.oldId,
    op.newId,
  );
  if (next !== content) {
    useFileStore.getState().setFileContent(op.filePath, next);
    useEditorStore.getState().markDirty(op.tabId, true);
  }
  if (!draining) {
    enqueue(op);
    return "content";
  }
  return next !== content
    ? "content"
    : dropped(op, "the cached text has no such block");
}

/**
 * The tab was closed within the round trip: the saved file is the document.
 * `writeFile` is the app's atomic write and keeps the watcher quiet, so the
 * index is refreshed here; a failure of that leaves the file right and only
 * the backlinks stale, which is logged apart from a failed write.
 */
async function landOnDisk(op: CommittedBlockIdRename): Promise<Landing> {
  try {
    const content = await readFile(op.filePath);
    const next = renameBlockIdInMarkdown(
      content,
      op.filePath,
      op.oldId,
      op.newId,
    );
    if (next === content)
      return dropped(op, "the file on disk has no such block");
    await writeFile(op.filePath, next);
  } catch (e) {
    return dropped(op, `the file on disk could not be updated: ${String(e)}`);
  }
  try {
    await updateFileIndex(op.filePath);
    useLinkStore.getState().invalidate();
  } catch (e) {
    logger.warn(
      `[blockId] ${op.filePath} renamed on disk, but its index entry could not be refreshed: ${String(e)}`,
    );
  }
  return "disk";
}

/**
 * A background tab's `openFiles` snapshot and dirty flag follow its document.
 * The auto-save only watches the active tab (use-auto-save.ts), so a change
 * made to a background document must announce itself: the close/quit guard
 * writes dirty background tabs from `openFiles`.
 */
function publishBackgroundChange(
  op: CommittedBlockIdRename,
  state: EditorState,
): void {
  useFileStore
    .getState()
    .setFileContent(op.filePath, serializeEditorState(state));
  useEditorStore.getState().markDirty(op.tabId, true);
}

/**
 * Whether `view` still holds the document of `tabId`. The main editing surface
 * is ONE shared view whose document is swapped on every tab switch, plus a
 * pooled keep-alive editor (§perf-large-file C3.5) that keeps its own document
 * while its tab is in the background. A keep-alive view owns its document
 * until it is destroyed; the shared view owns a tab's document while that tab
 * is the one installed in it (`loadedTabId`, which — unlike the active tab id
 * — flips only once the content is actually in).
 */
function viewHoldsTab(view: EditorView, tabId: string): boolean {
  if (view.isDestroyed) return false;
  return isKeepaliveView(view) || loadedTabId() === tabId;
}

/** The pooled editor's DOM sits under the keep-alive marker (MarkdownSurface). */
function isKeepaliveView(view: EditorView): boolean {
  const dom = (view as { dom?: HTMLElement }).dom;
  return dom?.closest("[data-keepalive-editor]") !== null && dom !== undefined;
}
