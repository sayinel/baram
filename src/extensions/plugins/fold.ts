// Heading & List Folding — Obsidian-style fold/unfold
// ProseMirror Plugin + DecorationSet. Fold state is view-only:
// no doc mutation, no undo pollution, no roundtrip impact.
// Pattern: block-id-decoration.ts (Plugin + PluginKey + DecorationSet)

import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { changedRanges } from "../../utils/editor/changed-ranges";
import { PROGRESSIVE_LOAD_META } from "../../utils/editor/progressive-load";

// ── Types ──────────────────────────────────────────────────────────

export type FoldMeta =
  | { pos: number; type: "toggle" }
  | { positions: number[]; type: "restore" }
  | { type: "foldAll" }
  | { type: "unfoldAll" };

export interface FoldState {
  decorations: DecorationSet;
  foldedPositions: Set<number>;
  /**
   * True when a progressive-load chunk has been applied without a full
   * rebuild (PROGRESSIVE_LOAD_META was set). The next non-gated docChanged
   * must do a full buildDecorations to honour the C2 contract.
   */
  needsFullRebuild: boolean;
}

export const foldPluginKey = new PluginKey<FoldState>("fold");

// ── Fold range computation ─────────────────────────────────────────

export interface FoldableItem {
  foldFrom: number;
  foldTo: number;
  kind: "heading" | "listItem";
  node: PmNode;
  pos: number;
}

export interface FoldAnchor {
  level?: number;
  textPrefix: string;
  type: "heading" | "listItem";
}

/** Resolve content-based anchors back to doc positions */
export function anchorsToPositions(
  doc: PmNode,
  anchors: FoldAnchor[],
): number[] {
  const positions: number[] = [];
  const remaining = [...anchors];

  doc.descendants((node, pos) => {
    if (remaining.length === 0) return false;

    for (let i = 0; i < remaining.length; i++) {
      const anchor = remaining[i];
      const prefix = anchor.textPrefix.slice(0, 20);
      if (
        anchor.type === "heading" &&
        node.type.name === "heading" &&
        node.attrs.level === anchor.level &&
        node.textContent.startsWith(prefix)
      ) {
        positions.push(pos);
        remaining.splice(i, 1);
        break;
      }
      if (
        anchor.type === "listItem" &&
        node.type.name === "listItem" &&
        node.textContent.startsWith(prefix)
      ) {
        positions.push(pos);
        remaining.splice(i, 1);
        break;
      }
    }
    return true;
  });

  return positions;
}

export function dispatchFoldAll(view: EditorView): void {
  const tr = view.state.tr.setMeta(foldPluginKey, {
    type: "foldAll",
  } as FoldMeta);

  // Move selection to start of doc to avoid being inside folded region
  const $start = view.state.doc.resolve(0);
  tr.setSelection(TextSelection.near($start, 1));

  view.dispatch(tr);
}

// ── Widget DOM creators ────────────────────────────────────────────

export function dispatchRestoreFolds(
  view: EditorView,
  positions: number[],
): void {
  if (positions.length === 0) return;
  const tr = view.state.tr.setMeta(foldPluginKey, {
    type: "restore",
    positions,
  } as FoldMeta);
  view.dispatch(tr);
}

export function dispatchToggleFold(view: EditorView, pos: number): void {
  const state = foldPluginKey.getState(view.state);
  if (!state) return;

  const isFolding = !state.foldedPositions.has(pos);
  const tr = view.state.tr.setMeta(foldPluginKey, {
    type: "toggle",
    pos,
  } as FoldMeta);

  // Selection safety: move cursor out of fold range
  if (isFolding) {
    const range = getFoldRange(view.state.doc, pos);
    if (range) {
      const { from } = view.state.selection;
      if (from >= range.foldFrom && from < range.foldTo) {
        const $pos = view.state.doc.resolve(Math.max(0, range.foldFrom - 1));
        tr.setSelection(TextSelection.near($pos));
      }
    }
  }

  view.dispatch(tr);
}

// ── Decoration builder ─────────────────────────────────────────────

export function dispatchUnfoldAll(view: EditorView): void {
  const tr = view.state.tr.setMeta(foldPluginKey, {
    type: "unfoldAll",
  } as FoldMeta);
  view.dispatch(tr);
}

export function findAllFoldables(doc: PmNode): FoldableItem[] {
  return [...findFoldableHeadings(doc), ...findFoldableListItems(doc)];
}

// ── Anchor-based persistence ───────────────────────────────────────

/**
 * TEST-ONLY: incremented every time findFoldableHeadings runs a full doc walk.
 * Used by unit tests to verify the incremental plugin path skips the walk on
 * pure paragraph edits. Never read in production code.
 */
export let _findFoldableHeadingsCallCount = 0;

/** Reset the test-only call counter. Call from beforeEach in tests. */
export function _resetFindFoldableHeadingsCallCount(): void {
  _findFoldableHeadingsCallCount = 0;
}

/** Find all foldable headings — direct doc children only */
export function findFoldableHeadings(doc: PmNode): FoldableItem[] {
  _findFoldableHeadingsCallCount++;
  const items: FoldableItem[] = [];
  const children: { node: PmNode; pos: number }[] = [];

  doc.forEach((node, offset) => {
    children.push({ pos: offset, node });
  });

  for (let i = 0; i < children.length; i++) {
    const { pos, node } = children[i];
    if (node.type.name !== "heading") continue;

    const level = node.attrs.level as number;
    const foldFrom = pos + node.nodeSize;

    // Find next heading with level <= currentLevel (or doc end)
    let foldTo = doc.content.size;
    for (let j = i + 1; j < children.length; j++) {
      const next = children[j];
      if (
        next.node.type.name === "heading" &&
        (next.node.attrs.level as number) <= level
      ) {
        foldTo = next.pos;
        break;
      }
    }

    // Only foldable if there's content to fold
    if (foldTo > foldFrom) {
      items.push({ pos, node, foldFrom, foldTo, kind: "heading" });
    }
  }

  return items;
}

/** Find all foldable list items — those with nested sub-lists */
export function findFoldableListItems(doc: PmNode): FoldableItem[] {
  const items: FoldableItem[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== "listItem") return true;

    let hasNestedList = false;
    let firstChildSize = 0;
    let isFirst = true;

    node.forEach((child) => {
      if (isFirst) {
        firstChildSize = child.nodeSize;
        isFirst = false;
      }
      if (
        child.type.name === "bulletList" ||
        child.type.name === "orderedList" ||
        child.type.name === "taskList"
      ) {
        hasNestedList = true;
      }
    });

    if (hasNestedList && firstChildSize > 0) {
      const foldFrom = pos + 1 + firstChildSize;
      const foldTo = pos + node.nodeSize;
      if (foldTo > foldFrom) {
        items.push({ pos, node, foldFrom, foldTo, kind: "listItem" });
      }
    }

    return true;
  });

  return items;
}

/** Get the fold range for a specific position, or null if not foldable */
export function getFoldRange(
  doc: PmNode,
  pos: number,
): null | { foldFrom: number; foldTo: number } {
  const foldables = findAllFoldables(doc);
  const item = foldables.find((f) => f.pos === pos);
  return item ? { foldFrom: item.foldFrom, foldTo: item.foldTo } : null;
}

// ── Exported dispatch functions ────────────────────────────────────

/** Convert fold positions to content-based anchors for persistence */
export function positionsToAnchors(
  doc: PmNode,
  positions: Set<number>,
): FoldAnchor[] {
  const anchors: FoldAnchor[] = [];
  for (const pos of positions) {
    const node = doc.nodeAt(pos);
    if (!node) continue;
    if (node.type.name === "heading") {
      anchors.push({
        type: "heading",
        level: node.attrs.level as number,
        textPrefix: node.textContent.slice(0, 50),
      });
    } else if (node.type.name === "listItem") {
      anchors.push({
        type: "listItem",
        textPrefix: node.textContent.slice(0, 50),
      });
    }
  }
  return anchors;
}

/** Toggle fold at the cursor position (for keyboard shortcut) */
export function toggleFoldAtCursor(view: EditorView): boolean {
  const pos = findFoldableAtCursor(view.state);
  if (pos === null) return false;
  dispatchToggleFold(view, pos);
  return true;
}

function buildDecorations(
  doc: PmNode,
  foldedPositions: Set<number>,
): DecorationSet {
  const foldables = findAllFoldables(doc);
  if (foldables.length === 0) return DecorationSet.empty;

  const decos: Decoration[] = [];

  for (const item of foldables) {
    const isFolded = foldedPositions.has(item.pos);

    // §perf-large-file C3.1d: use content-stable key (not pos) so downstream
    // widgets survive position shifts without DOM teardown when a heading is edited.
    const stableKey =
      item.kind === "heading"
        ? `${item.node.attrs.level as number}-${item.node.textContent.slice(0, 40)}`
        : item.node.textContent.slice(0, 40);

    // Gutter arrow widget — inside the node, before text
    decos.push(
      Decoration.widget(
        item.pos + 1,
        () => createFoldArrow(isFolded, item.pos),
        { side: -1, key: `fold-arrow-${stableKey}-${isFolded}` },
      ),
    );

    if (isFolded) {
      // Ellipsis at end of heading / first paragraph
      const ellipsisPos =
        item.kind === "heading"
          ? item.pos + item.node.nodeSize - 1
          : item.pos + 1 + getFirstChildSize(item.node) - 1;

      decos.push(
        Decoration.widget(ellipsisPos, () => createEllipsis(item.pos), {
          side: 1,
          key: `fold-ellipsis-${stableKey}`,
        }),
      );

      // Hide content in the fold range
      if (item.kind === "heading") {
        // Hide each direct doc child in [foldFrom, foldTo)
        doc.forEach((child, offset) => {
          if (
            offset >= item.foldFrom &&
            offset + child.nodeSize <= item.foldTo
          ) {
            decos.push(
              Decoration.node(offset, offset + child.nodeSize, {
                class: "fold-hidden",
              }),
            );
          }
        });
      } else {
        // List item: hide all children after the first
        const listItemNode = doc.nodeAt(item.pos);
        if (listItemNode) {
          let childPos = item.pos + 1;
          let isFirst = true;
          listItemNode.forEach((child) => {
            if (!isFirst) {
              decos.push(
                Decoration.node(childPos, childPos + child.nodeSize, {
                  class: "fold-hidden",
                }),
              );
            }
            childPos += child.nodeSize;
            isFirst = false;
          });
        }
      }
    }
  }

  return DecorationSet.create(doc, decos);
}

function createEllipsis(pos: number): HTMLElement {
  const span = document.createElement("span");
  span.className = "fold-ellipsis";
  span.textContent = "⋯";
  span.setAttribute("data-fold-pos", String(pos));
  span.contentEditable = "false";
  return span;
}

function createFoldArrow(folded: boolean, pos: number): HTMLElement {
  const span = document.createElement("span");
  span.className = `fold-arrow ${folded ? "fold-arrow-folded" : "fold-arrow-open"}`;
  span.setAttribute("data-fold-pos", String(pos));
  span.contentEditable = "false";
  return span;
}

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
            // Check for heading or listItem in the changed range
            let found = false;
            newState.doc.nodesBetween(r.from, r.to, (node) => {
              if (
                node.type.name === "heading" ||
                node.type.name === "listItem"
              ) {
                found = true;
                return false;
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
        mousedown(view: EditorView, event: MouseEvent): boolean {
          const target = event.target as HTMLElement;
          if (!target) return false;

          const foldEl = target.closest(".fold-arrow, .fold-ellipsis");
          if (!foldEl) return false;

          // §perf-large-file C3: Resolve the heading/listItem position at click
          // time rather than reading the potentially-stale `data-fold-pos`
          // attribute (which was written at decoration-creation time and is not
          // updated when edits above this widget shift doc positions).
          //
          // Strategy: walk up from the widget element to find the containing
          // top-level block's DOM node, then use posAtDOM to get its current
          // doc position.  Fall back to the attribute only if posAtDOM fails.
          let pos: null | number = null;
          try {
            // The widget is rendered inside the heading/listItem's DOM node.
            // posAtDOM on the widget element itself gives the position of the
            // widget inside that node; we want the node's own start position.
            // Walking up to the first direct child of the editor's DOM root
            // gives us a node whose posAtDOM result we can resolve to depth-0.
            const editorDom = view.dom;
            let el: HTMLElement | null = foldEl as HTMLElement;
            while (el && el.parentElement && el.parentElement !== editorDom) {
              el = el.parentElement;
            }
            if (el && el.parentElement === editorDom) {
              const rawPos = view.posAtDOM(el, 0);
              // posAtDOM returns a position inside the node; resolve to the
              // node's outer start by going to depth-0 ancestor.
              const $resolved = view.state.doc.resolve(rawPos);
              // depth-0 ancestor's before() is the node's start pos in the doc.
              pos = $resolved.depth > 0 ? $resolved.before(1) : rawPos;
            }
          } catch {
            pos = null;
          }

          // Fallback: use the attribute (may be stale but better than nothing).
          if (pos === null) {
            const attrPos = Number(foldEl.getAttribute("data-fold-pos"));
            if (!isNaN(attrPos)) pos = attrPos;
          }

          if (pos === null) return false;

          event.preventDefault();
          event.stopPropagation();
          dispatchToggleFold(view, pos);
          return true;
        },
      },
    },
  });
}

/** Get the closest foldable heading/listItem at or containing the cursor */
function findFoldableAtCursor(state: EditorState): null | number {
  const { $from } = state.selection;
  const foldables = findAllFoldables(state.doc);

  // Check if cursor is directly inside a foldable heading (depth 1 = direct doc child)
  for (let d = $from.depth; d >= 1; d--) {
    const ancestor = $from.node(d);
    const ancestorPos = $from.before(d);
    if (foldables.some((f) => f.pos === ancestorPos)) {
      return ancestorPos;
    }
    // Also check if cursor is in content under a heading
    if (ancestor.type.name === "heading" || ancestor.type.name === "listItem") {
      break;
    }
  }

  // If cursor is in content below a heading, find the heading that owns this region
  const cursorPos = $from.pos;
  for (const item of foldables) {
    if (item.kind === "heading") {
      if (cursorPos >= item.pos && cursorPos < item.foldTo) {
        return item.pos;
      }
    }
  }

  return null;
}

// ── Plugin factory ─────────────────────────────────────────────────

function getFirstChildSize(node: PmNode): number {
  let size = 0;
  let found = false;
  node.forEach((child) => {
    if (!found) {
      size = child.nodeSize;
      found = true;
    }
  });
  return size;
}

// ── Tiptap Extension wrapper ───────────────────────────────────────

export const Fold = Extension.create({
  name: "fold",

  addProseMirrorPlugins() {
    return [createFoldPlugin()];
  },
});
