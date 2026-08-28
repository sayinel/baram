import type { Node as PmNode, ResolvedPos } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

// §30a Block ID Visible Decoration — entry bookkeeping (pure)
// Owns the BlockIdEntry/BlockIdDecoState shapes plus every pure function that
// builds, diffs, or remaps them. DOM/event concerns (widget creation,
// commit/cancel) live in block-id-widgets.ts; this module imports the three
// widget factories from there (one-way) for the Decoration.widget callbacks
// in make*Deco. Nothing here reaches back into block-id-widgets.ts's
// commit/cancel logic or into block-id-decoration.ts.
import { changedRanges } from "../../utils/editor/changed-ranges";
import {
  createEditWidget,
  createFocusedWidget,
  createHintWidget,
} from "./block-id-widgets";

// ── Plugin state ──────────────────────────────────────────────────────

export interface BlockIdDecoState {
  decorations: DecorationSet;
  editingBlockPos: null | number;
  entries: BlockIdEntry[];
  focusedBlockPos: null | number;
  /** Map from blockId → count of blocks in the doc that have that id. */
  idCountMap: Map<string, number>;
  /**
   * True after the first full build has run. Prevents re-firing the init walk
   * on every transaction for docs with zero block-IDs (entries.length === 0
   * can't be used as a sentinel because it also matches legitimate empty docs).
   */
  initialized: boolean;
  /**
   * Set to true when a progressive-load (gated) transaction was applied so
   * that the next non-gated docChanged triggers a full rebuild to catch all
   * the skipped chunks.
   */
  needsFullRebuild: boolean;
}

export interface BlockIdEntry {
  blockId: string;
  /**
   * §perf-large-file C3.1d: Cached Decoration object for this entry.
   * Reusing the same Decoration object (same WidgetType instance) lets
   * DecorationSet.eq() short-circuit via reference equality (this == other),
   * which prevents PM from calling updateChildren on unchanged paragraphs.
   */
  deco: Decoration;
  endPos: number;
  pos: number;
}

/** Build an id→count map from scratch from an entries array. O(n). */
export function buildIdCountMap(entries: BlockIdEntry[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const { blockId } of entries) {
    map.set(blockId, (map.get(blockId) ?? 0) + 1);
  }
  return map;
}

/** Walk the doc once and collect all blocks that have a blockId attr. */
export function collectBlockIdEntries(
  doc: PmNode,
  focusedBlockPos: null | number = null,
  editingBlockPos: null | number = null,
): BlockIdEntry[] {
  const entries: BlockIdEntry[] = [];
  doc.descendants((node: PmNode, pos: number) => {
    if (node.type.name !== "paragraph" && node.type.name !== "heading") {
      return true;
    }
    const blockId = node.attrs.blockId as null | string;
    if (blockId) {
      const endPos = pos + node.nodeSize - 1;
      entries.push({
        pos,
        blockId,
        endPos,
        deco: makeEntryDeco(
          blockId,
          pos,
          endPos,
          focusedBlockPos,
          editingBlockPos,
        ),
      });
    }
    return false; // Don't descend into paragraphs/headings
  });
  return entries;
}

/**
 * Resolve the position of the nearest paragraph/heading ancestor that carries
 * a blockId, or null. Shared by the deferred-init branch and the
 * selection-driven apply path so both compute the focused block identically.
 */
export function findFocusedBlockPos($from: ResolvedPos): null | number {
  for (let d = $from.depth; d >= 1; d--) {
    const ancestor = $from.node(d);
    if (
      (ancestor.type.name === "paragraph" ||
        ancestor.type.name === "heading") &&
      ancestor.attrs.blockId
    ) {
      return $from.before(d);
    }
  }
  return null;
}

/** Create an editing (input widget) Decoration for an entry. */
export function makeEditDeco(
  blockId: string,
  endPos: number,
  pos: number,
): Decoration {
  return Decoration.widget(
    endPos,
    (view: EditorView) => createEditWidget(blockId, view, pos),
    { side: 1, key: `block-id-edit-${blockId}` },
  );
}

/**
 * Create the appropriate Decoration for an entry given the current focus/edit state.
 * §perf-large-file C3.1d: cached on entry so the same object is reused across applies.
 */
export function makeEntryDeco(
  blockId: string,
  pos: number,
  endPos: number,
  focusedBlockPos: null | number,
  editingBlockPos: null | number,
): Decoration {
  if (editingBlockPos === pos) return makeEditDeco(blockId, endPos, pos);
  if (focusedBlockPos === pos) return makeFocusDeco(blockId, endPos);
  return makeHintDeco(blockId, endPos);
}

/** Create a focused (visible text) Decoration for an entry. */
export function makeFocusDeco(blockId: string, endPos: number): Decoration {
  return Decoration.widget(endPos, () => createFocusedWidget(blockId), {
    side: 1,
    key: `block-id-focus-${blockId}`,
  });
}

/** Create a hint (anchor dot) Decoration for an entry. */
export function makeHintDeco(blockId: string, endPos: number): Decoration {
  return Decoration.widget(endPos, () => createHintWidget(blockId), {
    side: 1,
    // §perf-large-file C3.1d: blockId-stable key (not pos) so downstream
    // widgets survive position shifts without DOM teardown.
    key: `block-id-hint-${blockId}`,
  });
}

/**
 * §perf-large-file C3.1d: Rebuild Decoration objects only for entries whose
 * focus/editing role changed. All other entries keep their cached Decoration
 * object (same WidgetType instance → DecorationSet.eq short-circuits).
 *
 * Called on selection-only transactions where focusedBlockPos/editingBlockPos
 * changes but the doc is unchanged.
 */
export function rebuildFocusDecos(
  entries: BlockIdEntry[],
  oldFocusedPos: null | number,
  oldEditingPos: null | number,
  newFocusedPos: null | number,
  newEditingPos: null | number,
): BlockIdEntry[] {
  // Positions that need a new Decoration (at most 2: old focused and new focused)
  const affected = new Set<number>();
  if (oldFocusedPos !== newFocusedPos) {
    if (oldFocusedPos !== null) affected.add(oldFocusedPos);
    if (newFocusedPos !== null) affected.add(newFocusedPos);
  }
  if (oldEditingPos !== newEditingPos) {
    if (oldEditingPos !== null) affected.add(oldEditingPos);
    if (newEditingPos !== null) affected.add(newEditingPos);
  }
  if (affected.size === 0) return entries; // fast path: nothing changed

  return entries.map((entry) => {
    if (!affected.has(entry.pos)) return entry; // reuse same object
    return {
      ...entry,
      deco: makeEntryDeco(
        entry.blockId,
        entry.pos,
        entry.endPos,
        newFocusedPos,
        newEditingPos,
      ),
    };
  });
}

/**
 * §perf-large-file C3.1d: Create a new Decoration wrapper at a new position
 * reusing the existing WidgetType instance from `oldDeco`.
 *
 * PM's WidgetType.map() does exactly `new Decoration(newPos, newPos, this)` —
 * same WidgetType instance, new position wrapper. We replicate that here so
 * that position-shifted survivors still give `this == other` in WidgetType.eq(),
 * letting DecorationSet.eq() short-circuit matchesNode for unchanged paragraphs.
 *
 * The WidgetType is accessed via `(deco as any).type` — PM doesn't expose it
 * publicly but it is a stable internal field present since prosemirror-view 1.x.
 */
export function remapDeco(oldDeco: Decoration, newEndPos: number): Decoration {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const widgetType = (oldDeco as any).type as unknown;
  // Construct via Decoration.widget so the public API is used for the wrapper,
  // but pass the existing WidgetType's toDOM and spec so the same instance is
  // retrieved from the created Decoration. Actually we need the constructor directly.
  // PM's Decoration constructor is not exported, but we can access it from an
  // existing instance: `Object.getPrototypeOf(oldDeco).constructor`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DecoCtor = (oldDeco as any).constructor as new (
    from: number,
    to: number,
    type: unknown,
  ) => Decoration;
  return new DecoCtor(newEndPos, newEndPos, widgetType);
}

/**
 * Update entries incrementally for a set of changed ranges.
 * Returns the new entries array plus separate dropped/added arrays so the
 * caller can update idCountMap in O(changed) rather than O(all entries).
 *
 * Old-doc changed ranges are read directly from StepMap forEach (oldStart,
 * oldEnd) which gives the correct pre-edit positions, avoiding the ambiguity
 * that arises when using new-doc coordinates for deletion detection.
 */
export function updateEntriesIncremental(
  oldEntries: BlockIdEntry[],
  tr: Transaction,
  newDoc: PmNode,
  focusedBlockPos: null | number,
  editingBlockPos: null | number,
  oldFocusedBlockPos: null | number,
  oldEditingBlockPos: null | number,
): { added: BlockIdEntry[]; dropped: BlockIdEntry[]; entries: BlockIdEntry[] } {
  // Collect old-doc changed ranges from StepMap old-coordinate callbacks.
  const oldRanges: { from: number; to: number }[] = [];
  for (const map of tr.mapping.maps) {
    map.forEach((oldStart, oldEnd) => {
      oldRanges.push({ from: oldStart, to: oldEnd });
    });
  }

  // Partition old entries: drop those whose old position was inside a changed
  // range; map the rest forward.
  const dropped: BlockIdEntry[] = [];
  const surviving: BlockIdEntry[] = [];
  for (const entry of oldEntries) {
    const inOldRange = oldRanges.some(
      (r) => entry.pos >= r.from && entry.pos < r.to,
    );
    if (inOldRange) {
      dropped.push(entry);
    } else {
      const newPos = tr.mapping.map(entry.pos);
      const newEndPos = tr.mapping.map(entry.endPos);
      // §perf-large-file C3.1d: reuse the same Decoration object when the
      // entry's position and role haven't changed. This preserves WidgetType
      // instance identity so DecorationSet.eq() short-circuits via `this == other`.
      const newRole =
        editingBlockPos === newPos
          ? "edit"
          : focusedBlockPos === newPos
            ? "focus"
            : "hint";
      const oldRole =
        oldEditingBlockPos === entry.pos
          ? "edit"
          : oldFocusedBlockPos === entry.pos
            ? "focus"
            : "hint";
      const sameRole = newRole === oldRole;
      const samePos = newPos === entry.pos && newEndPos === entry.endPos;

      let deco: Decoration;
      if (samePos && sameRole) {
        // Nothing changed — reuse the exact same Decoration object.
        deco = entry.deco;
      } else if (sameRole) {
        // Position shifted but role unchanged — reuse WidgetType instance.
        // §perf-large-file C3.1d: remapDeco creates new Decoration wrapper at
        // newEndPos with the SAME WidgetType instance → `this == other` in
        // WidgetType.eq() → DecorationSet.eq() short-circuits matchesNode.
        deco = remapDeco(entry.deco, newEndPos);
      } else {
        // Role changed — need a fresh Decoration with the correct widget type.
        deco = makeEntryDeco(
          entry.blockId,
          newPos,
          newEndPos,
          focusedBlockPos,
          editingBlockPos,
        );
      }
      surviving.push({
        pos: newPos,
        blockId: entry.blockId,
        endPos: newEndPos,
        deco,
      });
    }
  }

  // Re-collect entries from the new-doc changed ranges.
  // Deduplicate by position; skip positions already in surviving (a node that
  // spans the change point is visited by nodesBetween for each range it overlaps).
  const survivingPosSet = new Set(surviving.map((e) => e.pos));
  const newDocRanges = changedRanges(tr);
  const freshMap = new Map<number, BlockIdEntry>();
  for (const range of newDocRanges) {
    newDoc.nodesBetween(range.from, range.to, (node: PmNode, pos: number) => {
      if (node.type.name !== "paragraph" && node.type.name !== "heading") {
        return true;
      }
      const blockId = node.attrs.blockId as null | string;
      if (blockId && !freshMap.has(pos) && !survivingPosSet.has(pos)) {
        const endPos = pos + node.nodeSize - 1;
        freshMap.set(pos, {
          pos,
          blockId,
          endPos,
          deco: makeEntryDeco(
            blockId,
            pos,
            endPos,
            focusedBlockPos,
            editingBlockPos,
          ),
        });
      }
      return false;
    });
  }

  const added = [...freshMap.values()];
  return { entries: [...surviving, ...added], dropped, added };
}

/**
 * Update an existing idCountMap O(changed) instead of O(all entries).
 * Decrements counts for removed entries, increments for added entries.
 * Entries with count reaching 0 are removed from the map.
 */
export function updateIdCountMap(
  base: Map<string, number>,
  removed: BlockIdEntry[],
  added: BlockIdEntry[],
): Map<string, number> {
  const map = new Map(base);
  for (const { blockId } of removed) {
    const count = (map.get(blockId) ?? 0) - 1;
    if (count <= 0) map.delete(blockId);
    else map.set(blockId, count);
  }
  for (const { blockId } of added) {
    map.set(blockId, (map.get(blockId) ?? 0) + 1);
  }
  return map;
}
