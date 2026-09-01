// Heading & List Folding — decoration builder + widget DOM creators

import type { Node as PmNode } from "@tiptap/pm/model";

import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { findAllFoldables, getFirstChildSize } from "./fold-ranges";

// ── Decoration builder ─────────────────────────────────────────────

export function buildDecorations(
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
