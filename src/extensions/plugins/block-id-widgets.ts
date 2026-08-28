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

import { readFile, renameBlockId, updateFileIndex } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
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

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const newId = input.value.trim();
      if (!newId) {
        // Empty → remove block ID
        commitBlockIdEdit(view, nodePos, null);
      } else if (!isValidBlockId(newId)) {
        input.classList.add("block-id-input-invalid");
      } else if (isDuplicateBlockId(view.state.doc, newId, nodePos)) {
        input.classList.add("block-id-input-invalid");
      } else {
        commitBlockIdEdit(view, nodePos, newId);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelBlockIdEdit(view);
    } else if (e.key === "Backspace" && input.value === "") {
      e.preventDefault();
      e.stopPropagation();
      commitBlockIdEdit(view, nodePos, null);
    }
    // Prevent ProseMirror from handling the event
    e.stopPropagation();
  });

  input.addEventListener("blur", () => {
    const newId = input.value.trim();
    if (!newId) {
      commitBlockIdEdit(view, nodePos, null);
    } else if (
      isValidBlockId(newId) &&
      !isDuplicateBlockId(view.state.doc, newId, nodePos)
    ) {
      commitBlockIdEdit(view, nodePos, newId);
    } else {
      cancelBlockIdEdit(view);
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

export function commitBlockIdEdit(
  view: EditorView,
  nodePos: number,
  newId: null | string,
): void {
  const node = view.state.doc.nodeAt(nodePos);
  if (!node) return;

  const oldId = node.attrs.blockId as null | string;
  const { tr } = view.state;
  tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, blockId: newId });

  // §30a-2: Update same-document blockReference/blockEmbed nodes
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
  view.focus();

  // §30a-2: Update cross-file references via IPC
  if (oldId && newId && oldId !== newId) {
    const activeTabId = useEditorStore.getState().activeTabId;
    const tabs = useEditorStore.getState().tabs;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const filePath = activeTab?.filePath;
    if (filePath) {
      renameBlockId(filePath, oldId, newId)
        .then(async (result) => {
          if (result.updatedFiles.length === 0) return;
          // Reload updated files in the file store cache so tab switches show new content
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
            // Re-index the updated file
            updateFileIndex(updatedPath).catch(() => {});
          }
          useLinkStore.getState().invalidate();
        })
        .catch((e) => logger.error(e));
    }
  }
}
