// §30a Block ID Visible Decoration — Focus-Reveal + Hint Dot
// When cursor is in a block with a blockId: show ` ^blockId` text
// When cursor is elsewhere: show ⚓ hint dot
// Double-click focused widget → inline edit mode
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import { generateBlockId } from "../../pipeline/block-id";
import { renameBlockId, readFile, updateFileIndex } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor-store";
import { useFileStore } from "../../stores/file-store";
import { useLinkStore } from "../../stores/link-store";

// ── Plugin state ──────────────────────────────────────────────────────

interface BlockIdEntry {
  pos: number;
  blockId: string;
  endPos: number;
}

interface BlockIdDecoState {
  focusedBlockPos: number | null;
  editingBlockPos: number | null;
  decorations: DecorationSet;
  entries: BlockIdEntry[];
}

/** Walk the doc once and collect all blocks that have a blockId attr. */
function collectBlockIdEntries(doc: PmNode): BlockIdEntry[] {
  const entries: BlockIdEntry[] = [];
  doc.descendants((node: PmNode, pos: number) => {
    if (
      node.type.name !== "paragraph" &&
      node.type.name !== "heading"
    ) {
      return true;
    }
    const blockId = node.attrs.blockId as string | null;
    if (blockId) {
      entries.push({ pos, blockId, endPos: pos + node.nodeSize - 1 });
    }
    return false; // Don't descend into paragraphs/headings
  });
  return entries;
}

/** Build DecorationSet from cached entries without walking the doc. */
function buildDecosFromEntries(
  doc: PmNode,
  entries: BlockIdEntry[],
  focusedBlockPos: number | null,
  editingBlockPos: number | null,
): DecorationSet {
  if (entries.length === 0) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const { pos, blockId, endPos } of entries) {
    if (editingBlockPos === pos) {
      decos.push(
        Decoration.widget(
          endPos,
          (view: EditorView) => createEditWidget(blockId, view, pos),
          { side: 1, key: `block-id-edit-${pos}` },
        ),
      );
    } else if (focusedBlockPos === pos) {
      decos.push(
        Decoration.widget(
          endPos,
          () => createFocusedWidget(blockId),
          { side: 1, key: `block-id-focus-${pos}` },
        ),
      );
    } else {
      decos.push(
        Decoration.widget(
          endPos,
          () => createHintWidget(blockId),
          { side: 1, key: `block-id-hint-${pos}` },
        ),
      );
    }
  }
  return DecorationSet.create(doc, decos);
}

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

function createHintWidget(blockId: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "block-id-hint";
  span.textContent = "#";
  span.title = `^${blockId}`;
  span.contentEditable = "false";
  return span;
}

function createFocusedWidget(blockId: string): HTMLElement {
  const span = document.createElement("span");
  span.className = "block-id-focused";
  span.textContent = ` ^${blockId}`;
  span.contentEditable = "false";
  return span;
}

function createEditWidget(
  blockId: string,
  view: EditorView,
  nodePos: number,
): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = "block-id-editing";
  wrapper.contentEditable = "false";

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
    } else if (isValidBlockId(newId) && !isDuplicateBlockId(view.state.doc, newId, nodePos)) {
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

// ── Commit / Cancel ──────────────────────────────────────────────────

function commitBlockIdEdit(
  view: EditorView,
  nodePos: number,
  newId: string | null,
): void {
  const node = view.state.doc.nodeAt(nodePos);
  if (!node) return;

  const oldId = node.attrs.blockId as string | null;
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
        .catch(console.error);
    }
  }
}

function cancelBlockIdEdit(view: EditorView): void {
  const state = blockIdDecoKey.getState(view.state);
  const { tr } = view.state;
  tr.setMeta(blockIdDecoKey, {
    focusedBlockPos: state?.editingBlockPos ?? null,
    editingBlockPos: null,
  });
  view.dispatch(tr);
  view.focus();
}

// ── Exported utility functions (for ContextMenu / BlockHandle) ───────

export function addBlockId(view: EditorView, nodePos: number): void {
  const node = view.state.doc.nodeAt(nodePos);
  if (!node) return;

  const id = generateBlockId();
  const { tr } = view.state;
  tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, blockId: id });
  view.dispatch(tr);
}

export function editBlockId(view: EditorView, nodePos: number): void {
  const { tr } = view.state;
  tr.setMeta(blockIdDecoKey, {
    focusedBlockPos: nodePos,
    editingBlockPos: nodePos,
  });
  view.dispatch(tr);
}

export function removeBlockId(view: EditorView, nodePos: number): void {
  const node = view.state.doc.nodeAt(nodePos);
  if (!node) return;

  const { tr } = view.state;
  tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, blockId: null });
  view.dispatch(tr);
}

export function copyBlockId(blockId: string): void {
  navigator.clipboard.writeText(`^${blockId}`);
}

// ── Plugin factory ────────────────────────────────────────────────────

function createBlockIdDecoPlugin(): Plugin<BlockIdDecoState> {
  return new Plugin<BlockIdDecoState>({
    key: blockIdDecoKey,

    state: {
      init(): BlockIdDecoState {
        // §perf-large-file: Defer initial build to first transaction
        return {
          focusedBlockPos: null,
          editingBlockPos: null,
          decorations: DecorationSet.empty,
          entries: [],
        };
      },

      apply(
        tr: Transaction,
        value: BlockIdDecoState,
        _oldState: EditorState,
        newState: EditorState,
      ): BlockIdDecoState {
        // §perf-large-file: Deferred init — build on first transaction
        if (value.entries.length === 0 && newState.doc.content.size > 0) {
          const entries = collectBlockIdEntries(newState.doc);
          return {
            focusedBlockPos: null,
            editingBlockPos: null,
            entries,
            decorations: buildDecosFromEntries(newState.doc, entries, null, null),
          };
        }

        // Explicit meta overrides (from commitBlockIdEdit, editBlockId, etc.)
        const meta = tr.getMeta(blockIdDecoKey) as
          | { focusedBlockPos: number | null; editingBlockPos: number | null }
          | undefined;
        if (meta !== undefined) {
          const entries = tr.docChanged
            ? collectBlockIdEntries(newState.doc)
            : value.entries;
          return {
            ...meta,
            entries,
            decorations: buildDecosFromEntries(
              newState.doc, entries, meta.focusedBlockPos, meta.editingBlockPos,
            ),
          };
        }

        // Map editingBlockPos through transaction
        let editingBlockPos = value.editingBlockPos;
        if (editingBlockPos !== null) {
          editingBlockPos = tr.mapping.map(editingBlockPos);
          const node = newState.doc.nodeAt(editingBlockPos);
          if (
            !node ||
            (node.type.name !== "paragraph" && node.type.name !== "heading")
          ) {
            editingBlockPos = null;
          }
        }

        // Compute focusedBlockPos from cursor
        let focusedBlockPos: number | null = null;
        const { selection } = newState;
        const $from = selection.$from;
        for (let d = $from.depth; d >= 1; d--) {
          const ancestor = $from.node(d);
          if (
            (ancestor.type.name === "paragraph" ||
              ancestor.type.name === "heading") &&
            ancestor.attrs.blockId
          ) {
            focusedBlockPos = $from.before(d);
            break;
          }
        }

        if (
          editingBlockPos !== null &&
          editingBlockPos !== focusedBlockPos
        ) {
          editingBlockPos = null;
        }

        // Fast path: nothing changed → reuse cached state entirely
        if (
          !tr.docChanged &&
          focusedBlockPos === value.focusedBlockPos &&
          editingBlockPos === value.editingBlockPos
        ) {
          return value;
        }

        // Doc changed → rebuild entries from scratch; otherwise reuse
        const entries = tr.docChanged
          ? collectBlockIdEntries(newState.doc)
          : value.entries;

        return {
          focusedBlockPos,
          editingBlockPos,
          entries,
          decorations: buildDecosFromEntries(
            newState.doc, entries, focusedBlockPos, editingBlockPos,
          ),
        };
      },
    },

    props: {
      decorations(state: EditorState): DecorationSet {
        const pluginState = blockIdDecoKey.getState(state);
        return pluginState?.decorations ?? DecorationSet.empty;
      },

      handleDoubleClickOn(
        view: EditorView,
        _pos: number,
        _node: PmNode,
        _nodePos: number,
        event: MouseEvent,
      ): boolean {
        const target = event.target as HTMLElement;
        if (!target) return false;

        // Check if clicked on .block-id-focused widget
        const focusedEl = target.closest?.(".block-id-focused");
        if (!focusedEl) return false;

        // Find which block this belongs to
        const pluginState = blockIdDecoKey.getState(view.state);
        if (!pluginState?.focusedBlockPos) return false;

        editBlockId(view, pluginState.focusedBlockPos);
        return true;
      },
    },
  });
}

// ── Tiptap Extension wrapper ──────────────────────────────────────────

export const BlockIdDecoration = Extension.create({
  name: "blockIdDecoration",

  addProseMirrorPlugins() {
    return [createBlockIdDecoPlugin()];
  },
});
