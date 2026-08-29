import type { BlockIdDecoState, BlockIdEntry } from "./block-id-entries";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

// §30a Block ID Visible Decoration — Focus-Reveal + Hint Dot
// When cursor is in a block with a blockId: show ` ^blockId` text
// When cursor is elsewhere: show ⚓ hint dot
// Double-click focused widget → inline edit mode
import { Extension } from "@tiptap/core";
import { Plugin, type Transaction } from "@tiptap/pm/state";
import { DecorationSet, type EditorView } from "@tiptap/pm/view";

import { generateBlockId } from "../../pipeline/block-id";
import { PROGRESSIVE_LOAD_META } from "../../utils/editor/progressive-load";
import {
  buildIdCountMap,
  collectBlockIdEntries,
  findFocusedBlockPos,
  rebuildFocusDecos,
  updateEntriesIncremental,
  updateIdCountMap,
} from "./block-id-entries";
import {
  BLOCK_ID_PATTERN,
  blockIdDecoKey,
  isDuplicateBlockId,
  isValidBlockId,
} from "./block-id-widgets";
import { withVimExternalEdit } from "./vim/vim-keys";

// Re-exported so external callers (ContextMenu, BlockHandleMenu, tests) keep
// importing them from this module — the physical definitions live in
// block-id-widgets.ts, the leaf that actually needs them internally.
export { BLOCK_ID_PATTERN, blockIdDecoKey, isDuplicateBlockId, isValidBlockId };

/** Build DecorationSet from cached entries without walking the doc. */
function buildDecosFromEntries(
  doc: PmNode,
  entries: BlockIdEntry[],
): DecorationSet {
  // §perf-large-file C3.1d: entries carry pre-built Decoration objects.
  // Unchanged entries reuse the same WidgetType instance → DecorationSet.eq()
  // short-circuits via `this == other` → matchesNode skips updateChildren.
  if (entries.length === 0) return DecorationSet.empty;
  const decos = entries.map((e) => e.deco);
  return DecorationSet.create(doc, decos);
}

// ── Exported utility functions (for ContextMenu / BlockHandle) ───────

export function addBlockId(view: EditorView, nodePos: number): void {
  const node = view.state.doc.nodeAt(nodePos);
  if (!node) return;

  const id = generateBlockId();
  const { tr } = view.state;
  tr.setNodeMarkup(nodePos, undefined, { ...node.attrs, blockId: id });
  view.dispatch(withVimExternalEdit(tr));
}

export function copyBlockId(blockId: string): void {
  navigator.clipboard.writeText(`^${blockId}`);
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
  view.dispatch(withVimExternalEdit(tr));
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
          idCountMap: new Map(),
          initialized: false,
          needsFullRebuild: false,
        };
      },

      apply(
        tr: Transaction,
        value: BlockIdDecoState,
        _oldState: EditorState,
        newState: EditorState,
      ): BlockIdDecoState {
        // §perf-large-file: Deferred init — build on first transaction.
        // Use explicit `initialized` flag rather than `entries.length === 0`
        // because DecorationSet.create(doc,[]) returns the shared empty
        // instance and an empty doc legitimately has zero entries.
        if (!value.initialized && newState.doc.content.size > 0) {
          // Progressive-load chunk arriving before init: stay deferred and flag
          // a rebuild rather than collecting every entry now — collecting here
          // would defeat the large-file progressive-load optimization.
          if (tr.getMeta(PROGRESSIVE_LOAD_META) === true) {
            return {
              focusedBlockPos: null,
              editingBlockPos: null,
              entries: [],
              idCountMap: new Map(),
              initialized: true,
              needsFullRebuild: true,
              decorations: DecorationSet.empty,
            };
          }
          // Honor explicit meta if present, else derive focus from the current
          // selection so a block that already holds the cursor at init renders
          // focused, not hinted. (Pre-tiptap-3.27, editor creation dispatched a
          // transaction that consumed this deferred init with the empty initial
          // doc, so the first *real* transaction always took the normal path
          // below; 3.27 no longer dispatches it, so init must compute focus
          // itself — otherwise the first edit leaves the focused block hinted.)
          const initMeta = tr.getMeta(blockIdDecoKey) as
            | undefined
            | {
                editingBlockPos: null | number;
                focusedBlockPos: null | number;
              };
          const focusedBlockPos =
            initMeta?.focusedBlockPos ??
            findFocusedBlockPos(newState.selection.$from);
          const editingBlockPos = initMeta?.editingBlockPos ?? null;
          const entries = collectBlockIdEntries(
            newState.doc,
            focusedBlockPos,
            editingBlockPos,
          );
          return {
            focusedBlockPos,
            editingBlockPos,
            entries,
            idCountMap: buildIdCountMap(entries),
            initialized: true,
            needsFullRebuild: false,
            decorations: buildDecosFromEntries(newState.doc, entries),
          };
        }

        // Explicit meta overrides (from commitBlockIdEdit, editBlockId, etc.)
        const meta = tr.getMeta(blockIdDecoKey) as
          | undefined
          | { editingBlockPos: null | number; focusedBlockPos: null | number };
        if (meta !== undefined) {
          const skipRebuild = tr.getMeta(PROGRESSIVE_LOAD_META) === true;
          let entries: BlockIdEntry[];
          let idCountMap: Map<string, number>;
          let needsFullRebuild = value.needsFullRebuild;
          if (tr.docChanged) {
            if (skipRebuild) {
              // Progressive-load chunk: map positions, flag for full rebuild later
              entries = value.entries;
              idCountMap = value.idCountMap;
              needsFullRebuild = true;
            } else if (needsFullRebuild) {
              // First non-progressive docChanged after progressive load: full rebuild
              entries = collectBlockIdEntries(
                newState.doc,
                meta.focusedBlockPos,
                meta.editingBlockPos,
              );
              idCountMap = buildIdCountMap(entries);
              needsFullRebuild = false;
            } else {
              const result = updateEntriesIncremental(
                value.entries,
                tr,
                newState.doc,
                meta.focusedBlockPos,
                meta.editingBlockPos,
                value.focusedBlockPos,
                value.editingBlockPos,
              );
              entries = result.entries;
              idCountMap = updateIdCountMap(
                value.idCountMap,
                result.dropped,
                result.added,
              );
            }
          } else {
            // Selection-only with meta: update deco for focus-changed entries only.
            entries = rebuildFocusDecos(
              value.entries,
              value.focusedBlockPos,
              value.editingBlockPos,
              meta.focusedBlockPos,
              meta.editingBlockPos,
            );
            idCountMap = value.idCountMap;
          }
          return {
            ...meta,
            entries,
            idCountMap,
            initialized: true,
            needsFullRebuild,
            decorations: buildDecosFromEntries(newState.doc, entries),
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
        const focusedBlockPos = findFocusedBlockPos(newState.selection.$from);

        if (editingBlockPos !== null && editingBlockPos !== focusedBlockPos) {
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

        // Doc changed → update entries; skip during progressive load
        const skipRebuild = tr.getMeta(PROGRESSIVE_LOAD_META) === true;
        let entries: BlockIdEntry[];
        let idCountMap: Map<string, number>;
        let needsFullRebuild = value.needsFullRebuild;
        // initialized is true from here on (deferred-init branch handled above)

        if (tr.docChanged) {
          if (skipRebuild) {
            // Progressive-load chunk: map positions only, flag for full rebuild
            entries = value.entries;
            idCountMap = value.idCountMap;
            needsFullRebuild = true;
          } else if (needsFullRebuild) {
            // First non-progressive docChanged after progressive load: full rebuild
            entries = collectBlockIdEntries(
              newState.doc,
              focusedBlockPos,
              editingBlockPos,
            );
            idCountMap = buildIdCountMap(entries);
            needsFullRebuild = false;
          } else {
            // §perf-large-file C3.1: incremental entry update + O(changed) map
            // §perf-large-file C3.1d: pass focus state so surviving entries get
            // the right Decoration object cached (preserves WidgetType identity).
            // Pass old positions so oldRole is derived from previous state, not new.
            const result = updateEntriesIncremental(
              value.entries,
              tr,
              newState.doc,
              focusedBlockPos,
              editingBlockPos,
              value.focusedBlockPos,
              value.editingBlockPos,
            );
            entries = result.entries;
            idCountMap = updateIdCountMap(
              value.idCountMap,
              result.dropped,
              result.added,
            );
          }
        } else {
          // Selection-only change: rebuild deco only for the two focus-affected entries.
          entries = rebuildFocusDecos(
            value.entries,
            value.focusedBlockPos,
            value.editingBlockPos,
            focusedBlockPos,
            editingBlockPos,
          );
          idCountMap = value.idCountMap;
        }

        return {
          focusedBlockPos,
          editingBlockPos,
          entries,
          idCountMap,
          initialized: true,
          needsFullRebuild,
          decorations: buildDecosFromEntries(newState.doc, entries),
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
