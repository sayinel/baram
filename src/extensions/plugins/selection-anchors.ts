// §388 spec 0067 §7 — refs a plugin got from `getSelection()`, followed through every
// transaction so a later replace hits the range that was read.
//
// Positions live per document NODE (a WeakMap keyed by `state.doc`), not as "the last
// document": `state.apply` also runs for states that never reach the view (the insert
// pipeline's shadow check, spec §7.3), and a tab switch reinstalls an older document
// without a transaction. A document that is not in the table was installed some other
// way — that is the "other document" refusal — and switching back finds its entry again.
//
// This module knows nothing of plugins or refusal codes (plan 0117 P4): it reports a
// reason, and `src/plugins/editor-ops.ts` turns it into a code.
import type { Node as PmNode } from "@tiptap/pm/model";
import type { Mapping } from "@tiptap/pm/transform";

import { Extension } from "@tiptap/core";
import {
  AllSelection,
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  type Transaction,
} from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

import { canonicalDoc } from "../../utils/editor/serialize-live-doc";
import {
  SYNTAX_REVEAL_EPHEMERAL_META,
  syntaxRevealKey,
} from "./syntax-reveal-state";

export type AnchorFailure = "other-document" | "range-changed" | "unknown";

export type AnchorKind = "all" | "cell" | "node" | "text";

export type AnchorLocation =
  { from: number; ok: true; to: number } | { ok: false; reason: AnchorFailure };

export type AnchorVerification =
  | { from: number; kind: AnchorKind; ok: true; to: number }
  | { ok: false; reason: AnchorFailure };

interface AnchorRange {
  from: number;
  to: number;
}

interface AnchorRecord {
  hash: string;
  implicit: boolean;
  kind: AnchorKind;
  length: number;
  node: null | PmNode;
  nonEmpty: boolean;
  owner: string;
  positions: WeakMap<PmNode, "lost" | AnchorRange>;
}

/** Recorded refs per plugin; the oldest is dropped past this (spec §7.4). */
export const MAX_ANCHORS_PER_OWNER = 16;

const anchors = new Map<string, AnchorRecord>();
let mappingPasses = 0;

export const selectionAnchorsKey = new PluginKey("selectionAnchors");

/** Recorded (non-implicit) refs this owner holds. */
export function anchorCount(owner: string): number {
  let n = 0;
  for (const a of anchors.values()) if (a.owner === owner && !a.implicit) n++;
  return n;
}

/** The selection kind a ref was issued for, or `null` if it is unknown or another owner's. */
export function anchorKindOf(owner: string, ref: string): AnchorKind | null {
  const record = anchors.get(ref);
  return record && record.owner === owner ? record.kind : null;
}

/** Test probe (spec §11-9): how many transactions did mapping work. */
export function anchorMappingPasses(): number {
  return mappingPasses;
}

/**
 * The range's text with expanded reveal delimiters left out (spec §5, §7.1). An inverted
 * range — an expanded atom's source maps that way — is normalised to an empty one.
 */
export function canonicalRangeText(
  state: EditorState,
  from: number,
  to: number,
): AnchorRange & { text: string } {
  const { doc, mapping } = canonicalDoc(state);
  let a = from;
  let b = to;
  if (mapping) {
    a = mapping.map(from, 1);
    b = mapping.map(to, -1);
    if (a > b) b = a = Math.min(a, b);
  }
  return { from: a, text: doc.textBetween(a, b, "\n"), to: b };
}

/** Forget every ref an owner holds — on plugin unload (spec §7.4). */
export function dropAnchors(owner: string): void {
  for (const [ref, a] of anchors) if (a.owner === owner) anchors.delete(ref);
}

/**
 * Issue a ref for the current selection. `record: false` hands out an id that names
 * nothing — for a plugin that cannot write (spec §7.1). `implicit` anchors back a write
 * that passed no ref; they do not count toward the cap and the caller releases them.
 */
export function issueAnchor(
  owner: string,
  state: EditorState,
  options: { implicit?: boolean; record?: boolean } = {},
): string {
  const ref = crypto.randomUUID().replace(/-/gu, "");
  if (options.record === false) return ref;
  const sel = state.selection;
  const kind: AnchorKind =
    sel instanceof AllSelection
      ? "all"
      : sel instanceof CellSelection
        ? "cell"
        : sel instanceof NodeSelection
          ? "node"
          : "text";
  const canonical = canonicalRangeText(state, sel.from, sel.to);
  const positions = new WeakMap<PmNode, "lost" | AnchorRange>();
  positions.set(state.doc, { from: sel.from, to: sel.to });
  anchors.set(ref, {
    hash: fnv1a(canonical.text),
    implicit: options.implicit === true,
    kind,
    length: canonical.text.length,
    node: sel instanceof NodeSelection ? sel.node : null,
    nonEmpty: canonical.to > canonical.from,
    owner,
    positions,
  });
  if (!options.implicit) evictOldest(owner);
  return ref;
}

/** Where the ref points in `doc`, without checking what is there. */
export function locateAnchor(
  owner: string,
  ref: string,
  doc: PmNode,
): AnchorLocation {
  const record = anchors.get(ref);
  if (!record || record.owner !== owner)
    return { ok: false, reason: "unknown" };
  const at = record.positions.get(doc);
  if (at === undefined) return { ok: false, reason: "other-document" };
  if (at === "lost") return { ok: false, reason: "range-changed" };
  return { from: at.from, ok: true, to: Math.max(at.from, at.to) };
}

/** Forget one ref — after a successful write, or an implicit ref when its write ends. */
export function releaseAnchor(ref: string): void {
  anchors.delete(ref);
}

/**
 * Locate the ref and check that what it covers is what was read (spec §7.3 step 4). Call
 * it on a document whose expansion over the range has been collapsed — then the live text
 * there IS the canonical text the hash was taken from.
 */
export function verifyAnchor(
  owner: string,
  ref: string,
  doc: PmNode,
): AnchorVerification {
  const at = locateAnchor(owner, ref, doc);
  if (!at.ok) return at;
  const record = anchors.get(ref)!;
  const { from, to } = at;
  const changed = { ok: false, reason: "range-changed" } as const;
  if (record.nonEmpty && to <= from) return changed;
  if (
    record.kind === "text" &&
    (!doc.resolve(from).parent.isTextblock ||
      !doc.resolve(to).parent.isTextblock)
  ) {
    return changed;
  }
  const text = doc.textBetween(from, to, "\n");
  if (text.length !== record.length || fnv1a(text) !== record.hash)
    return changed;
  if (record.kind === "node") {
    const node = doc.nodeAt(from);
    if (!node || !record.node?.eq(node) || from + node.nodeSize !== to)
      return changed;
  }
  return { from, kind: record.kind, ok: true, to };
}

function evictOldest(owner: string): void {
  if (anchorCount(owner) <= MAX_ANCHORS_PER_OWNER) return;
  for (const [ref, a] of anchors) {
    if (a.owner === owner && !a.implicit) {
      anchors.delete(ref);
      return;
    }
  }
}

/** FNV-1a 32-bit over UTF-16 code units (plan 0117 P5) — a change detector, not a MAC. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

function mapRange(
  mapping: Mapping,
  range: AnchorRange,
  keepDeleted: boolean,
): "lost" | AnchorRange {
  if (range.from === range.to) {
    const r = mapping.mapResult(range.from, -1);
    return r.deletedAcross && !keepDeleted
      ? "lost"
      : { from: r.pos, to: r.pos };
  }
  const a = mapping.mapResult(range.from, 1);
  const b = mapping.mapResult(range.to, -1);
  if ((a.deletedAcross || b.deletedAcross) && !keepDeleted) return "lost";
  return { from: a.pos, to: b.pos };
}

function track(
  tr: Transaction,
  oldState: EditorState,
  newState: EditorState,
): void {
  if (anchors.size === 0 || !tr.docChanged) return;
  mappingPasses++;
  // Spec §7.2 — a mark or link collapse deletes only delimiters and keeps content in
  // place (spec §4), so a position it deletes is not one the user removed. An atom
  // collapse turns text into a node: there the position really is gone.
  const kind = syntaxRevealKey.getState(oldState)?.expanded?.kind;
  const keepDeleted =
    tr.getMeta(SYNTAX_REVEAL_EPHEMERAL_META) === true &&
    (kind === "mark" || kind === "link");
  for (const record of anchors.values()) {
    const at = record.positions.get(oldState.doc);
    if (at === undefined) continue;
    record.positions.set(
      newState.doc,
      at === "lost" ? "lost" : mapRange(tr.mapping, at, keepDeleted),
    );
  }
}

/** The core plugin that feeds the table (spec §7.2). Installed by `createBaramExtensions`. */
export const SelectionAnchors = Extension.create({
  name: "selectionAnchors",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: selectionAnchorsKey,
        state: {
          init: () => null,
          apply(tr, value, oldState, newState) {
            track(tr, oldState, newState);
            return value;
          },
        },
      }),
    ];
  },
});
