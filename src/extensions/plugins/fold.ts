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

    if (item.kind === "heading") {
      // §perf-large-file C4: the heading fold arrow is rendered via a CSS
      // pseudo-element (`.tiptap > hN::before`, hover-shown), NOT a widget
      // decoration. Emitting one gutter-arrow widget per heading meant the
      // DecorationSet held ~1,391 widgets on the perf fixture, and PM's
      // per-keystroke `DecorationSet.map(...)` over that whole set cost ~40ms on
      // EVERY keystroke (even the map-only path). With CSS rendering, an OPEN
      // heading contributes zero decorations; only a FOLDED heading gets a
      // `fold-collapsed` node-class decoration (CSS rotates its arrow + keeps it
      // visible). So the set is empty when nothing is folded and the
      // per-keystroke map drops toward ~0. Gutter clicks are detected by
      // coordinate (see handleDOMEvents.mousedown).
      if (isFolded) {
        decos.push(
          Decoration.node(
            item.pos,
            item.pos + item.node.nodeSize,
            { class: "fold-collapsed" },
            { key: `fold-collapsed-${stableKey}` },
          ),
        );
      }
    } else {
      // List items keep a gutter-arrow widget. Foldable list items (those with a
      // nested sub-list) are far fewer than headings, so the per-keystroke map
      // cost is negligible, and this preserves the exact list-fold interaction
      // (the arrow is a real click target).
      decos.push(
        Decoration.widget(
          item.pos + 1,
          () => createFoldArrow(isFolded, item.pos),
          { side: -1, key: `fold-arrow-${stableKey}-${isFolded}` },
        ),
      );
    }

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
        mousedown(view: EditorView, event: MouseEvent): boolean {
          const target = event.target as HTMLElement;
          if (!target) return false;

          const foldEl = target.closest(".fold-arrow, .fold-ellipsis");
          if (!foldEl) {
            // §perf-large-file C4: heading arrows are CSS pseudo-elements with no
            // DOM node, so a click on a heading's gutter cannot be detected via
            // `closest()`. Resolve it by coordinate instead.
            const headingPos = resolveHeadingGutterFold(view, event);
            if (headingPos === null) return false;
            event.preventDefault();
            event.stopPropagation();
            dispatchToggleFold(view, headingPos);
            return true;
          }

          // §perf-large-file C3: Resolve the heading/listItem position at click
          // time rather than reading the potentially-stale `data-fold-pos`
          // attribute (which was written at decoration-creation time and is not
          // updated when edits above this widget shift doc positions).
          //
          // Strategy: walk up from the widget element to the nearest <li>/<hN>
          // block it lives in, then use posAtDOM + resolve to that block's OWN
          // start position. A list item lives at depth ≥2 (doc > list >
          // listItem), so the previous "walk to the editor's direct child +
          // before(1)" returned the parent LIST's position, not the listItem's,
          // and the toggle dispatch silently no-op'd. Resolve to the innermost
          // heading/listItem ancestor depth instead. Fall back to the attribute
          // only if resolution fails.
          let pos: null | number = null;
          try {
            const blockEl = (foldEl as HTMLElement).closest(
              "li, h1, h2, h3, h4, h5, h6",
            );
            if (blockEl instanceof HTMLElement && view.dom.contains(blockEl)) {
              const rawPos = view.posAtDOM(blockEl, 0);
              const $resolved = view.state.doc.resolve(rawPos);
              for (let d = $resolved.depth; d >= 1; d--) {
                const ancestor = $resolved.node(d);
                if (
                  ancestor.type.name === "listItem" ||
                  ancestor.type.name === "heading"
                ) {
                  pos = $resolved.before(d);
                  break;
                }
              }
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

// ── Plugin factory ─────────────────────────────────────────────────

/**
 * §perf-large-file C4: detect a click on a top-level heading's gutter fold
 * arrow, rendered as a CSS pseudo-element (`.tiptap > hN::before`, which is
 * `pointer-events: auto`). Returns the heading's doc position when a FOLDABLE
 * heading's gutter arrow was clicked, else null.
 *
 * MUST stay coordinate-free: `.editor-area-scroll` uses CSS `zoom`, under which
 * WKWebView's `MouseEvent.clientX` / `getBoundingClientRect()` / `posAtCoords`
 * live in mismatched coordinate spaces (see [[wkwebview-css-zoom-coords]]) — so
 * the earlier `posAtCoords` + rect approach silently never fired. Instead:
 *   1. A click on the `::before` arrow reports `event.target` === the heading
 *      element (pseudo-elements forward events to their host).
 *   2. `event.offsetX < 0` means the click landed left of the heading's content
 *      box, i.e. in the gutter where the arrow sits. The SIGN of offsetX is
 *      invariant under any positive `zoom`, so this needs no zoom math.
 *   3. The heading's doc position is resolved via `posAtDOM` (DOM-based, also
 *      zoom-safe), exactly as the list-item/ellipsis widget path does.
 */
function resolveHeadingGutterFold(
  view: EditorView,
  event: MouseEvent,
): null | number {
  const target = event.target as HTMLElement | null;
  const heading = target?.closest("h1, h2, h3, h4, h5, h6");
  if (!(heading instanceof HTMLElement) || !view.dom.contains(heading)) {
    return null;
  }
  // Only the gutter (left of the heading content box) toggles; clicks on the
  // heading text fall through to normal cursor placement.
  if (event.offsetX >= 0) return null;

  let topPos: number;
  try {
    const rawPos = view.posAtDOM(heading, 0);
    const $resolved = view.state.doc.resolve(rawPos);
    topPos = $resolved.depth > 0 ? $resolved.before(1) : rawPos;
  } catch {
    return null;
  }

  // Only foldable headings toggle (don't pollute foldedPositions with headings
  // that have no content to fold).
  if (!getFoldRange(view.state.doc, topPos)) return null;
  return topPos;
}

// ── Tiptap Extension wrapper ───────────────────────────────────────

export const Fold = Extension.create({
  name: "fold",

  addProseMirrorPlugins() {
    return [createFoldPlugin()];
  },
});
