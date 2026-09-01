// Heading & List Folding — plugin state types, PluginKey, and anchor helpers

import type { Node as PmNode } from "@tiptap/pm/model";
import type { DecorationSet } from "@tiptap/pm/view";

import { PluginKey } from "@tiptap/pm/state";

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

// ── Anchor-based persistence ───────────────────────────────────────

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
