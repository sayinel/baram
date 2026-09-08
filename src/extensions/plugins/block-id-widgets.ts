// §30a Block ID Visible Decoration — DOM widgets + commit/cancel
// Leaf module: owns the plugin key, validation, and every DOM/event concern
// (widget creation, edit-input handling, commit/cancel). block-id-entries.ts
// imports the three widget creators from here (one-way); this file must not
// import from block-id-entries.ts or block-id-decoration.ts at the value
// level. The one exception is the `BlockIdDecoState` type import below, which
// is `import type` and is fully erased at compile time (verbatimModuleSyntax
// guarantees no emitted require/import) — it exists only so `blockIdDecoKey`
// can carry its real state shape instead of `unknown`.
import type { BlockIdDecoState } from "./block-id-entries";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

import { PluginKey } from "@tiptap/pm/state";

import { type Locale, t } from "../../i18n";
import { readFile, renameBlockId, updateFileIndex } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { landCommittedBlockIdRename } from "../../utils/editor/block-id-rename-landing";
import { logger } from "../../utils/logger";

export const blockIdDecoKey = new PluginKey<BlockIdDecoState>(
  "blockIdDecoration",
);

// ── Validation ────────────────────────────────────────────────────────

/** Block ID must start with [a-zA-Z0-9] followed by [\w-]* */
export const BLOCK_ID_PATTERN = /^[a-zA-Z0-9][\w-]*$/;

export function isValidBlockId(id: string): boolean {
  return BLOCK_ID_PATTERN.test(id);
}

/** Check if a block ID is already used by another node in the document */
export function isDuplicateBlockId(
  doc: PmNode,
  id: string,
  excludePos: number,
): boolean {
  let found = false;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (
      (node.type.name === "paragraph" || node.type.name === "heading") &&
      node.attrs.blockId === id &&
      pos !== excludePos
    ) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

// ── Widget DOM creators ──────────────────────────────────────────────

export function createEditWidget(
  blockId: string,
  view: EditorView,
  nodePos: number,
): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "block-id-editing";
  wrapper.contentEditable = "false";
  // §298 §12-3: input island — vim suspends while focus is inside (design §4).
  // The widget is recreated every render, so the marker must be set here.
  wrapper.setAttribute("data-vim-suspend", "");

  const caret = document.createElement("span");
  caret.className = "block-id-caret";
  caret.textContent = " ^";

  const input = document.createElement("input");
  input.className = "block-id-input";
  input.type = "text";
  input.value = blockId;
  input.size = Math.max(blockId.length, 4);

  // Auto-size input as user types
  input.addEventListener("input", () => {
    input.size = Math.max(input.value.length, 4);
    if (input.value && !isValidBlockId(input.value)) {
      input.classList.add("block-id-input-invalid");
    } else {
      input.classList.remove("block-id-input-invalid");
    }
  });

  // One outcome per widget. Enter commits and moves focus back to the editor,
  // which can blur this input while it is still in the DOM — and blur commits
  // too. With the commit now waiting on the backend (issue 594) the block
  // still carries the old ID at that moment, so a second commit would be a
  // second IPC call for the same rename. The first outcome wins.
  let settled = false;
  const settle = (outcome: () => void): void => {
    if (settled) return;
    settled = true;
    outcome();
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const newId = input.value.trim();
      if (!newId) {
        // Empty → remove block ID
        settle(() => commitBlockIdEdit(view, nodePos, null));
      } else if (!isValidBlockId(newId)) {
        input.classList.add("block-id-input-invalid");
      } else if (isDuplicateBlockId(view.state.doc, newId, nodePos)) {
        input.classList.add("block-id-input-invalid");
      } else {
        settle(() => commitBlockIdEdit(view, nodePos, newId));
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      settle(() => cancelBlockIdEdit(view));
    } else if (e.key === "Backspace" && input.value === "") {
      e.preventDefault();
      e.stopPropagation();
      settle(() => commitBlockIdEdit(view, nodePos, null));
    }
    // Prevent ProseMirror from handling the event
    e.stopPropagation();
  });

  input.addEventListener("blur", () => {
    const newId = input.value.trim();
    if (!newId) {
      settle(() => commitBlockIdEdit(view, nodePos, null));
    } else if (
      isValidBlockId(newId) &&
      !isDuplicateBlockId(view.state.doc, newId, nodePos)
    ) {
      settle(() => commitBlockIdEdit(view, nodePos, newId));
    } else {
      settle(() => cancelBlockIdEdit(view));
    }
  });

  wrapper.appendChild(caret);
  wrapper.appendChild(input);

  // Auto-focus the input after DOM insertion
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });

  return wrapper;
}

export function createFocusedWidget(blockId: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "block-id-focused";
  span.textContent = ` ^${blockId}`;
  span.contentEditable = "false";
  return span;
}

export function createHintWidget(blockId: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "block-id-hint";
  span.textContent = "#";
  span.title = `^${blockId}`;
  span.contentEditable = "false";
  return span;
}

// ── Commit / Cancel ──────────────────────────────────────────────────

interface FileTab {
  filePath: string;
  id: string;
}

export function cancelBlockIdEdit(view: EditorView): void {
  const state = blockIdDecoKey.getState(view.state);
  const { tr } = view.state;
  tr.setMeta(blockIdDecoKey, {
    focusedBlockPos: state?.editingBlockPos ?? null,
    editingBlockPos: null,
  });
  view.dispatch(tr);
  view.focus();
}

/**
 * Commit an edited block ID.
 *
 * A change of one ID to another is a rename that other files may have to
 * follow (`((file#^id))` references), and the backend decides whether it can
 * do that — it refuses when the file is outside every context or the link
 * index cannot be read. issue 594: the document changes only AFTER the backend
 * has said yes. Applying it first (as this used to) left the document on the
 * new ID and every other file on the old one when the backend refused, with
 * no way to retry: the old ID was gone. Now a refusal leaves the document as
 * it was, and the same edit can simply be made again.
 *
 * Adding an ID, removing one, or committing it unchanged involves no other
 * file and applies at once.
 */
export function commitBlockIdEdit(
  view: EditorView,
  nodePos: number,
  newId: null | string,
): void {
  const node = view.state.doc.nodeAt(nodePos);
  if (!node) return;

  const oldId = node.attrs.blockId as null | string;
  const isRename = oldId !== null && newId !== null && oldId !== newId;
  const tab = isRename ? activeFileTab() : null;
  if (!isRename || tab === null) {
    // Nothing elsewhere refers to this block by a path (no rename, or a tab
    // that has no file yet): apply here and be done.
    applyBlockId(view, nodePos, oldId, newId);
    view.focus();
    return;
  }

  // Close the input now — the widget must not wait on the IPC round trip —
  // and keep the block focused, still showing the old ID.
  const closing = view.state.tr;
  closing.setMeta(blockIdDecoKey, {
    focusedBlockPos: nodePos,
    editingBlockPos: null,
  });
  view.dispatch(closing);
  view.focus();

  // issue 263: `.then(onFulfilled, onRejected)`, NOT `.then(...).catch(...)`.
  // A trailing `.catch` also catches whatever the success body throws, and
  // the failure toast below says the ID was not changed — which by then
  // would be the opposite of the truth.
  renameBlockId(tab.filePath, oldId, newId).then(
    async (result) => {
      // The document follows — wherever it is by now (issue 594): still in
      // this view, in a keep-alive editor, cached behind another tab, in a
      // source-mode buffer, or only on disk if the tab was closed. It is found
      // by its ID, not by the position the edit started at.
      const landing = await landCommittedBlockIdRename(
        { filePath: tab.filePath, newId, oldId, tabId: tab.id },
        view,
      );
      if (landing === "dropped") {
        // The block ^oldId is nowhere the document could be — deleted or
        // renamed again meanwhile. The other files already say ^newId.
        toast("blockId.rename.stale.toast", "warning", { newId });
      }
      try {
        // Reload updated files in the file store cache so tab switches show
        // new content, and re-index each.
        const { openFiles, setFileContent } = useFileStore.getState();
        for (const updatedPath of result.updatedFiles) {
          if (openFiles.has(updatedPath)) {
            try {
              const content = await readFile(updatedPath);
              setFileContent(updatedPath, content);
            } catch {
              // file may have been deleted
            }
          }
          updateFileIndex(updatedPath).catch(() => {});
        }
        if (result.updatedFiles.length > 0) {
          useLinkStore.getState().invalidate();
        }
      } catch (e) {
        // The backend already rewrote the references; only the local cache
        // refresh failed. Log it — this body owns its own errors because
        // nobody holds the promise `.then(f, r)` returns, so an escape here
        // would be an unhandled rejection rather than a caught one.
        logger.error("[blockId] refreshing renamed references failed:", e);
      }
      // issue 594: referrers the backend could not rewrite still say the old
      // ID. That is in the result, not in an `Err`, and the user hears it.
      if (result.skippedFiles.length > 0) {
        logger.warn(
          "[blockId] renamed, but these referring files could not be updated:",
          result.skippedFiles,
        );
        toast("blockId.rename.skipped.toast", "warning", {
          count: String(result.skippedFiles.length),
        });
      }
    },
    (e) => {
      logger.error(e);
      // The document still carries the old ID: nothing to undo, the edit can
      // be made again once the reason is gone.
      toast("blockId.rename.failed.toast", "error", { message: String(e) });
    },
  );
}

/** The active tab and the file behind it, if it has one. */
function activeFileTab(): FileTab | null {
  const { activeTabId, tabs } = useEditorStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab?.filePath ? { filePath: tab.filePath, id: tab.id } : null;
}

/**
 * Set `newId` on the block at `nodePos` — an edit no other file can see
 * (adding an ID, removing one, an untitled tab) — and, should it be a rename
 * after all, on the same-document `blockReference`/`blockEmbed` nodes that
 * pointed at `oldId` (§30a-2). Closes the edit widget and leaves the block
 * focused. Does not move focus: the caller decides whether the editor should
 * take it. A rename the backend has committed goes through
 * `landCommittedBlockIdRename` instead, which keeps it out of the undo history.
 */
function applyBlockId(
  view: EditorView,
  nodePos: number,
  oldId: null | string,
  newId: null | string,
): void {
  const node = view.state.doc.nodeAt(nodePos);
  if (!node) return;
  const { tr } = view.state;
  tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, blockId: newId });
  if (oldId && newId && oldId !== newId) {
    view.state.doc.descendants((child, pos) => {
      if (
        (child.type.name === "blockReference" ||
          child.type.name === "blockEmbed") &&
        child.attrs.blockId === oldId
      ) {
        tr.setNodeMarkup(pos, undefined, { ...child.attrs, blockId: newId });
      }
      return true;
    });
  }
  tr.setMeta(blockIdDecoKey, {
    focusedBlockPos: nodePos,
    editingBlockPos: null,
  });
  view.dispatch(tr);
}

function toast(
  key: string,
  type: "error" | "warning",
  params?: Record<string, string>,
): void {
  const { locale } = useSettingsStore.getState();
  useUIStore.getState().showToast(t(key, locale as Locale, params), type);
}
