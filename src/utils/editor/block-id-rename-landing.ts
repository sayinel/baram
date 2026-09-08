// §30a issue 594 — a block ID rename the backend has committed lands in the
// document that defines the block, wherever that document is right now.
//
// `rename_block_id` rewrites `((file#^old))` in every OTHER file and leaves
// the defining document to the editor, which owns it. The editor commits its
// half only after the backend has said yes — and by then the user may have
// switched or closed the tab. The document is then not in the view that asked:
// it is a live keep-alive editor, a cached EditorState, a source-mode buffer,
// the `openFiles` snapshot, or only the file on disk. This module knows every
// one of those places and puts the rename into the one the document is in.
// A toast is a receipt, not a destination.
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { readFile, writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { logger } from "../logger";
import {
  refersToThisDocument,
  renameBlockIdInMarkdown,
} from "./block-id-rename-markdown";
import { isTabLoading, loadedTabId } from "./programmatic-update";
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
 * failed — and the caller tells the user. `pending`: the document is still
 * being installed; the queue is drained by `installContent`.
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
 * the disk; the promise settles when that write has too.
 */
export async function landCommittedBlockIdRename(
  op: CommittedBlockIdRename,
  view?: EditorView,
): Promise<Landing> {
  return land(op, view, false);
}

/**
 * `installContent` calls this once a tab's document is in an editor: renames
 * that arrived while it was being installed (or that only reached its text)
 * are re-landed against the real document. Idempotent — a document that
 * already says `newId` has no `oldId` block, and the entry is dropped quietly.
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

/** Forget the queued renames of tabs that are no longer open. */
export function prunePendingBlockIdRenames(
  openTabIds: ReadonlySet<string>,
): void {
  for (const tabId of pending.keys()) {
    if (!openTabIds.has(tabId)) pending.delete(tabId);
  }
}

const pending = new Map<string, CommittedBlockIdRename[]>();

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

  // 1. The view the edit was made in, if it still holds this tab's document.
  if (view && viewHoldsTab(view, op.tabId)) {
    const tr = buildBlockIdRenameTransaction(view.state, op);
    if (tr) {
      view.dispatch(tr);
      // The tab may already be on its way out: `saveOutgoingTab` has cached
      // its state and serialized it BEFORE this landed. Refresh both, or the
      // deferred restore brings the old ID back.
      if (editorStore.activeTabId !== op.tabId) {
        if (access?.editorStateCache.has(op.tabId)) {
          access.editorStateCache.set(op.tabId, view.state);
        }
        publishBackgroundChange(op, view.state);
      }
      return "view";
    }
    if (isTabLoading(op.tabId) && !draining) {
      // A progressive load is still appending blocks; ours may be among them.
      enqueue(op);
      return "pending";
    }
    return dropped(op, "the document in the editor has no such block");
  }

  // The tab is gone: only the file on disk is left to hold the definition.
  if (!tab) return landOnDisk(op);

  // 2. A source-mode tab: its buffer is the authoritative text.
  if (editorStore.sourceModeTabs.includes(op.tabId) && sourceBufferAccess) {
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

  // 3. A large document's keep-alive editor: live, but hidden while its tab is
  //    in the background, so nothing else marks it dirty for us.
  const pooled = access?.keepaliveEditor(op.tabId);
  if (pooled && !pooled.isDestroyed) {
    const tr = buildBlockIdRenameTransaction(pooled.state, op);
    if (!tr) return dropped(op, "the keep-alive editor has no such block");
    pooled.view.dispatch(tr);
    publishBackgroundChange(op, pooled.state);
    return "keepalive";
  }

  // 4. An ordinary background tab: its document is a cached EditorState (undo
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

  // 5. No document object anywhere, only text: a tab flagged stale (its cache
  //    was dropped) or one still being installed. Rename the text — it is what
  //    the next load parses — and re-check once a document is in.
  const content = useFileStore.getState().openFiles.get(op.filePath);
  if (content !== undefined) {
    const next = renameBlockIdInMarkdown(
      content,
      op.filePath,
      op.oldId,
      op.newId,
    );
    if (next !== content) {
      useFileStore.getState().setFileContent(op.filePath, next);
      editorStore.markDirty(op.tabId, true);
    }
    if (!draining) {
      enqueue(op);
      return "content";
    }
    return next !== content
      ? "content"
      : dropped(op, "the cached text has no such block");
  }
  if (draining) return dropped(op, "the document never became available");
  enqueue(op);
  return "pending";
}

/** The tab was closed within the round trip: the saved file is the document. */
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
    return "disk";
  } catch (e) {
    return dropped(op, `the file on disk could not be updated: ${String(e)}`);
  }
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
  const dom = (view as { dom?: HTMLElement }).dom;
  if (dom?.closest("[data-keepalive-editor]")) return true;
  return loadedTabId() === tabId;
}
