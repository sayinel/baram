// Heading & List Folding — Obsidian-style fold/unfold
// ProseMirror Plugin + DecorationSet. Fold state is view-only:
// no doc mutation, no undo pollution, no roundtrip impact.
// Pattern: block-id-decoration.ts (Plugin + PluginKey + DecorationSet)

import type { EditorState, Transaction } from "@tiptap/pm/state";

import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";

import { changedRanges } from "../../utils/editor/changed-ranges";
import { PROGRESSIVE_LOAD_META } from "../../utils/editor/progressive-load";
import { buildDecorations } from "./fold-decorations";
import { handleFoldMousedown } from "./fold-dom-events";
import { findAllFoldables } from "./fold-ranges";
import { type FoldMeta, foldPluginKey, type FoldState } from "./fold-state";

// ── Public API re-exports ────────────────────────────────────────────

export { foldPluginKey };

// ── Plugin factory ─────────────────────────────────────────────────

function createFoldPlugin(): Plugin<FoldState> {
  return new Plugin<FoldState>({
    key: foldPluginKey,

    state: {
      init(_config, state): FoldState {
        return {
          foldedPositions: new Set(),
          decorations: buildDecorations(state.doc, new Set()),
          needsFullRebuild: false,
        };
      },

      apply(
        tr: Transaction,
        value: FoldState,
        _oldState: EditorState,
        newState: EditorState,
      ): FoldState {
        const meta = tr.getMeta(foldPluginKey) as FoldMeta | undefined;

        if (meta) {
          let newFolded: Set<number>;

          switch (meta.type) {
            case "foldAll": {
              const foldables = findAllFoldables(newState.doc);
              newFolded = new Set(foldables.map((f) => f.pos));
              break;
            }
            case "restore": {
              newFolded = new Set(meta.positions);
              break;
            }
            case "toggle": {
              newFolded = new Set(value.foldedPositions);
              if (newFolded.has(meta.pos)) {
                newFolded.delete(meta.pos);
              } else {
                newFolded.add(meta.pos);
              }
              break;
            }
            case "unfoldAll": {
              newFolded = new Set();
              break;
            }
          }

          return {
            foldedPositions: newFolded,
            decorations: buildDecorations(newState.doc, newFolded),
            needsFullRebuild: false,
          };
        }

        // On doc change, remap positions and validate
        if (tr.docChanged) {
          const newFolded = new Set<number>();
          for (const pos of value.foldedPositions) {
            const mapped = tr.mapping.map(pos);
            const node = newState.doc.nodeAt(mapped);
            if (
              node &&
              (node.type.name === "heading" || node.type.name === "listItem")
            ) {
              newFolded.add(mapped);
            }
          }
          // §perf-large-file C2: Skip whole-doc rebuild during progressive load;
          // map existing decorations instead. Final (no-meta) chunk rebuilds fully.
          if (tr.getMeta(PROGRESSIVE_LOAD_META) === true) {
            return {
              foldedPositions: newFolded,
              decorations: value.decorations.map(tr.mapping, tr.doc),
              // §perf-large-file C3.1: flag so the first non-gated docChanged
              // performs a full rebuild to honour the C2 final-chunk contract.
              needsFullRebuild: true,
            };
          }

          // §perf-large-file C3.1: if a previous progressive-load chunk set the
          // flag, this is the first non-gated transaction — do the full rebuild.
          if (value.needsFullRebuild) {
            return {
              foldedPositions: newFolded,
              decorations: buildDecorations(newState.doc, newFolded),
              needsFullRebuild: false,
            };
          }

          // Pure incremental path: skip full descendants walk when the changed
          // range touches no heading or listItem AND doesn't span a depth-0 node
          // boundary (top-level insert/delete adjacent to a folded region).
          const ranges = changedRanges(tr);
          const needsRebuild = ranges.some((r) => {
            // §perf-large-file C3 (fold): rebuild only on a STRUCTURAL change to
            // the foldable set — a heading/listItem node whose BOUNDARY lies
            // within the edit (created, deleted, or level/markup changed; such
            // edits replace the node, so its start sits inside the changed
            // range). A pure CONTENT edit inside an existing heading/listItem
            // (the node spans the range, neither boundary inside it) leaves the
            // foldable set unchanged, so its decorations are simply mapped — this
            // avoids the ~50ms full findAllFoldables walk on every keystroke in a
            // heading on heading-dense documents.
            let found = false;
            newState.doc.nodesBetween(r.from, r.to, (node, pos) => {
              if (
                node.type.name === "heading" ||
                node.type.name === "listItem"
              ) {
                if (pos >= r.from || pos + node.nodeSize <= r.to) {
                  found = true;
                  return false;
                }
              }
              return !found;
            });
            if (found) return true;

            // Also trigger rebuild when a top-level block boundary was touched
            // (a plain-block insert/delete adjacent to a folded heading's hidden
            // range would otherwise leave stale hidden-node decorations).
            try {
              const $from = newState.doc.resolve(Math.max(0, r.from));
              const $to = newState.doc.resolve(
                Math.min(newState.doc.content.size, r.to),
              );
              if ($from.depth === 0 || $to.depth === 0) return true;
            } catch {
              return true;
            }
            return false;
          });

          if (!needsRebuild) {
            // Pure inline paragraph edit — reuse mapped decorations.
            return {
              foldedPositions: newFolded,
              decorations: value.decorations.map(tr.mapping, tr.doc),
              needsFullRebuild: false,
            };
          }
          return {
            foldedPositions: newFolded,
            decorations: buildDecorations(newState.doc, newFolded),
            needsFullRebuild: false,
          };
        }

        return value;
      },
    },

    props: {
      decorations(state: EditorState): DecorationSet {
        const pluginState = foldPluginKey.getState(state);
        return pluginState?.decorations ?? DecorationSet.empty;
      },

      handleDOMEvents: {
        mousedown: handleFoldMousedown,
      },
    },
  });
}

// ── Tiptap Extension wrapper ───────────────────────────────────────

export const Fold = Extension.create({
  name: "fold",

  addProseMirrorPlugins() {
    return [createFoldPlugin()];
  },
});
