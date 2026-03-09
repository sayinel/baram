// Heading & List Folding — Obsidian-style fold/unfold
// ProseMirror Plugin + DecorationSet. Fold state is view-only:
// no doc mutation, no undo pollution, no roundtrip impact.
// Pattern: block-id-decoration.ts (Plugin + PluginKey + DecorationSet)

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";

// ── Types ──────────────────────────────────────────────────────────

export interface FoldState {
  foldedPositions: Set<number>;
  decorations: DecorationSet;
}

export type FoldMeta =
  | { type: "toggle"; pos: number }
  | { type: "foldAll" }
  | { type: "unfoldAll" }
  | { type: "restore"; positions: number[] };

export const foldPluginKey = new PluginKey<FoldState>("fold");

// ── Fold range computation ─────────────────────────────────────────

export interface FoldableItem {
  pos: number;
  node: PmNode;
  foldFrom: number;
  foldTo: number;
  kind: "heading" | "listItem";
}

/** Find all foldable headings — direct doc children only */
export function findFoldableHeadings(doc: PmNode): FoldableItem[] {
  const items: FoldableItem[] = [];
  const children: { pos: number; node: PmNode }[] = [];

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

export function findAllFoldables(doc: PmNode): FoldableItem[] {
  return [...findFoldableHeadings(doc), ...findFoldableListItems(doc)];
}

/** Get the fold range for a specific position, or null if not foldable */
export function getFoldRange(
  doc: PmNode,
  pos: number,
): { foldFrom: number; foldTo: number } | null {
  const foldables = findAllFoldables(doc);
  const item = foldables.find((f) => f.pos === pos);
  return item ? { foldFrom: item.foldFrom, foldTo: item.foldTo } : null;
}

// ── Widget DOM creators ────────────────────────────────────────────

function createFoldArrow(folded: boolean, pos: number): HTMLElement {
  const span = document.createElement("span");
  span.className = `fold-arrow ${folded ? "fold-arrow-folded" : "fold-arrow-open"}`;
  span.setAttribute("data-fold-pos", String(pos));
  span.contentEditable = "false";
  return span;
}

function createEllipsis(pos: number): HTMLElement {
  const span = document.createElement("span");
  span.className = "fold-ellipsis";
  span.textContent = "⋯";
  span.setAttribute("data-fold-pos", String(pos));
  span.contentEditable = "false";
  return span;
}

// ── Decoration builder ─────────────────────────────────────────────

function buildDecorations(
  doc: PmNode,
  foldedPositions: Set<number>,
): DecorationSet {
  const foldables = findAllFoldables(doc);
  if (foldables.length === 0) return DecorationSet.empty;

  const decos: Decoration[] = [];

  for (const item of foldables) {
    const isFolded = foldedPositions.has(item.pos);

    // Gutter arrow widget — inside the node, before text
    decos.push(
      Decoration.widget(
        item.pos + 1,
        () => createFoldArrow(isFolded, item.pos),
        { side: -1, key: `fold-arrow-${item.pos}-${isFolded}` },
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
          key: `fold-ellipsis-${item.pos}`,
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

// ── Anchor-based persistence ───────────────────────────────────────

export interface FoldAnchor {
  type: "heading" | "listItem";
  level?: number;
  textPrefix: string;
}

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

// ── Exported dispatch functions ────────────────────────────────────

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

export function dispatchFoldAll(view: EditorView): void {
  const tr = view.state.tr.setMeta(foldPluginKey, {
    type: "foldAll",
  } as FoldMeta);

  // Move selection to start of doc to avoid being inside folded region
  const $start = view.state.doc.resolve(0);
  tr.setSelection(TextSelection.near($start, 1));

  view.dispatch(tr);
}

export function dispatchUnfoldAll(view: EditorView): void {
  const tr = view.state.tr.setMeta(foldPluginKey, {
    type: "unfoldAll",
  } as FoldMeta);
  view.dispatch(tr);
}

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

/** Check if a position is currently folded */
export function isFolded(state: EditorState, pos: number): boolean {
  const pluginState = foldPluginKey.getState(state);
  return pluginState?.foldedPositions.has(pos) ?? false;
}

/** Check if a document position falls within any folded region */
export function isInsideFoldedRegion(
  state: EditorState,
  targetPos: number,
): number | null {
  const pluginState = foldPluginKey.getState(state);
  if (!pluginState || pluginState.foldedPositions.size === 0) return null;

  const foldables = findAllFoldables(state.doc);
  for (const item of foldables) {
    if (!pluginState.foldedPositions.has(item.pos)) continue;
    if (targetPos >= item.foldFrom && targetPos < item.foldTo) {
      return item.pos;
    }
  }
  return null;
}

/** Auto-unfold the region containing targetPos, if it's folded */
export function autoUnfoldAt(view: EditorView, targetPos: number): void {
  const foldPos = isInsideFoldedRegion(view.state, targetPos);
  if (foldPos !== null) {
    dispatchToggleFold(view, foldPos);
  }
}

/** Get the closest foldable heading/listItem at or containing the cursor */
function findFoldableAtCursor(state: EditorState): number | null {
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

/** Toggle fold at the cursor position (for keyboard shortcut) */
export function toggleFoldAtCursor(view: EditorView): boolean {
  const pos = findFoldableAtCursor(view.state);
  if (pos === null) return false;
  dispatchToggleFold(view, pos);
  return true;
}

// ── Plugin factory ─────────────────────────────────────────────────

function createFoldPlugin(): Plugin<FoldState> {
  return new Plugin<FoldState>({
    key: foldPluginKey,

    state: {
      init(_config, state): FoldState {
        return {
          foldedPositions: new Set(),
          decorations: buildDecorations(state.doc, new Set()),
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
            case "toggle": {
              newFolded = new Set(value.foldedPositions);
              if (newFolded.has(meta.pos)) {
                newFolded.delete(meta.pos);
              } else {
                newFolded.add(meta.pos);
              }
              break;
            }
            case "foldAll": {
              const foldables = findAllFoldables(newState.doc);
              newFolded = new Set(foldables.map((f) => f.pos));
              break;
            }
            case "unfoldAll": {
              newFolded = new Set();
              break;
            }
            case "restore": {
              newFolded = new Set(meta.positions);
              break;
            }
          }

          return {
            foldedPositions: newFolded,
            decorations: buildDecorations(newState.doc, newFolded),
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
          return {
            foldedPositions: newFolded,
            decorations: buildDecorations(newState.doc, newFolded),
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

          const pos = Number(foldEl.getAttribute("data-fold-pos"));
          if (isNaN(pos)) return false;

          event.preventDefault();
          event.stopPropagation();
          dispatchToggleFold(view, pos);
          return true;
        },
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
