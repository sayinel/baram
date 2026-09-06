// §5.1 + §3.3 Syntax Reveal — state types, PluginKey, and shared helpers

import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { PluginKey } from "@tiptap/pm/state";

import { changedRanges } from "../../utils/editor/changed-ranges";
import { parseRevealResource } from "./syntax-reveal-resource-codec";

// ── Plugin state ──────────────────────────────────────────────────────

// §384 fix (R3 follow-up, not done here): this stays a flat interface with
// every kind-specific field optional, rather than a discriminated union that
// requires `labelEnd` for `kind: "link" | "image"`. A real union would catch
// a future caller constructing a link/image range without it at compile time
// instead of relying on every parseRevealResource call site to pass it
// correctly — but `ExpandedRange` is threaded through link.ts,
// syntax-reveal(-decorations|-collapse|-expand|.ts) and their tests, so
// narrowing the type is a multi-file refactor of its own, deliberately left
// for a separate change rather than folded into this fix.
export interface ExpandedRange {
  closeCheck?: string; // closing delimiter to validate (marks only)
  from: number; // start of expanded text (for images: inside paragraph)
  kind: "image" | "link" | "mark" | "wikilink";
  // §384 fix (F1 round 2): for kind "link"/"image" — doc-absolute position of
  // the `]` that opens `](destination…)`, stashed at expand time (see
  // expandLink, expandMediaAtom) instead of asked to be re-derived from text
  // alone by parseRevealResource's search (see syntax-reveal-resource-codec.ts
  // for why that search is resolvable but WRONG whenever the destination
  // itself contains a literal `](`). Mapped through edits in `apply()` below
  // exactly like `from`/`to`, so it stays correct while the label is actively
  // being typed into — assoc 1, same reasoning as `from`: an insertion AT this
  // position joins the label (pushes the `]` right) rather than the
  // destination.
  labelEnd?: number;
  // §384 fix (B): non-href/title link mark attrs (e.g. `target`) that
  // `[text](href)` cannot represent. Stashed here on expand so both collapse
  // sites (syntax-reveal.ts's appendTransaction and
  // syntax-reveal-collapse.ts) can merge them back into the recreated mark
  // instead of silently dropping them — see expandLink.
  linkAttrs?: Record<string, unknown>;
  markName?: string; // for marks: "bold", "italic", etc.
  // §294 fix (C1): non-src/alt/title attrs (image/video widthPercent, video
  // widthPixel) that `![alt](src)` cannot represent. Stashed here on expand so
  // both collapse sites (syntax-reveal.ts's appendTransaction and
  // syntax-reveal-collapse.ts) can merge them back instead of silently
  // falling back to the schema default — see expandMediaAtom.
  mediaAttrs?: Record<string, unknown>;
  openCheck: string; // opening delimiter to validate
  to: number; // end of expanded text
}

export interface SyntaxRevealState {
  expanded: ExpandedRange | null;
  /**
   * Inclusive doc range in which auto-expansion stays suppressed, or `null`
   * when nothing is suppressed. Recomputed on every transaction by
   * `nextSuppressed` — see there for what each kind of change suppresses.
   */
  suppressed: null | SuppressedRange;
}

/** Inclusive `[from, to]` doc range — see `SyntaxRevealState.suppressed`. */
export interface SuppressedRange {
  from: number;
  to: number;
}

export const INACTIVE: SyntaxRevealState = { expanded: null, suppressed: null };
export const syntaxRevealKey = new PluginKey<SyntaxRevealState>("syntaxReveal");

// ── Ephemeral provenance (§384 C) ─────────────────────────────────────

/**
 * Transaction meta key marking an expand/collapse transaction as ephemeral:
 * it changes the doc's REPRESENTATION (delimiters ⇄ marks/nodes) without
 * changing what the doc serializes to. Consumed by `isEphemeralOnlyUpdate`
 * (utils/editor/syntax-reveal-ephemeral.ts) so auto-save and the dirty
 * indicator can tell "the caret walked through a link" apart from a real
 * edit, instead of flickering dirty and scheduling a save on every reveal.
 *
 * Provenance only — deliberately NOT paired with `addToHistory: false`.
 * De-historifying expansion would make undo-after-Backspace restore the
 * literal delimiter text instead of the mark it replaced; history stays
 * exactly as it behaves today (§384 design descope 2).
 */
export const SYNTAX_REVEAL_EPHEMERAL_META = "syntaxRevealEphemeral";

/** Tag a transaction as an ephemeral expand/collapse (see the meta key above). */
export function tagSyntaxRevealEphemeral(tr: Transaction): void {
  tr.setMeta(SYNTAX_REVEAL_EPHEMERAL_META, true);
}

// ── Mark delimiter definitions ────────────────────────────────────────

export const MARK_DELIMITERS: Record<string, { close: string; open: string }> =
  {
    bold: { open: "**", close: "**" },
    italic: { open: "*", close: "*" },
    strike: { open: "~~", close: "~~" },
    code: { open: "`", close: "`" },
    underline: { open: "<u>", close: "</u>" },
    highlight: { open: "==", close: "==" },
    subscript: { open: "~", close: "~" },
    superscript: { open: "^", close: "^" },
  };

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Compute the content length (text between delimiters) of an expanded range.
 */
export function computeContentLen(
  state: EditorState,
  expanded: ExpandedRange,
): number {
  const { from, to, kind, openCheck, closeCheck, labelEnd } = expanded;
  if (kind === "mark" && closeCheck) {
    return to - closeCheck.length - (from + openCheck.length);
  }
  if (kind === "link") {
    try {
      const fullText = state.doc.textBetween(from, to);
      // §384 fix (F1): read the split from the shared parser instead of a
      // local `indexOf("](")` — see ParsedRevealResource.labelEnd.
      // §384 fix (F1 round 2): pass the stashed, mapped boundary (relative to
      // `fullText`) so the split is resolved exactly — see
      // ExpandedRange.labelEnd.
      // §384 (design review M2): missing stash falls back to the LIVE label
      // grammar, not strict — see syntax-reveal-collapse.ts's link branch.
      const parsed = parseRevealResource(
        fullText,
        labelEnd !== undefined
          ? { labelEnd: labelEnd - from }
          : { labelGrammar: "live" },
      );
      return parsed?.kind === "link" ? parsed.labelEnd - 1 : 0;
    } catch {
      return 0;
    }
  }
  if (kind === "wikilink") {
    // Wikilink atom node = 1 position when collapsed
    return 0;
  }
  return 0;
}

/**
 * Find the contiguous range of a specific mark that contains the cursor.
 */
export function findMarkRange(
  parentNode: PmNode,
  parentPos: number,
  markType: string,
  cursorPos: number,
): null | { from: number; to: number } {
  const ranges: { from: number; to: number }[] = [];

  parentNode.forEach((child, childOffset) => {
    const childFrom = parentPos + childOffset;
    const childTo = childFrom + child.nodeSize;
    if (child.marks.some((m) => m.type.name === markType)) {
      const last = ranges[ranges.length - 1];
      if (last && last.to === childFrom) {
        last.to = childTo;
      } else {
        ranges.push({ from: childFrom, to: childTo });
      }
    }
  });

  for (const range of ranges) {
    if (cursorPos >= range.from && cursorPos <= range.to) {
      return range;
    }
  }
  return null;
}

/**
 * Next value for `SyntaxRevealState.suppressed` (see there).
 *
 * Auto-expansion is driven by "the caret is next to / inside something
 * revealable", which is also true immediately *after* an edit that created
 * that something — so without a guard, typing `[[foo]]` would be undone by an
 * instant re-reveal, and stepping out of a reveal would step straight back in.
 *
 * The guard therefore suppresses expansion until the caret leaves the spot the
 * change happened at. Which spot that is depends on who made the change:
 *
 * - **Someone else's edit** (typing, an InputRule, a paste, a load): the caret
 *   position itself. Same rule the guard has always had.
 * - **Our own expand/collapse** (tagged ephemeral): only the range we rewrote.
 *   These transactions ride along with a caret move the user just made —
 *   `appendTransaction` collapses the old reveal in the SAME round that the
 *   arrow key lands the caret next to the NEXT node. Suppressing the whole
 *   round there cost one keypress per node, which on a list of bare wikilinks
 *   (`- [[A]]` / `- [[B]]`, nothing else on the line) meant every other item
 *   revealed nothing at all and the caret looked like it skipped it.
 *
 * `null` means nothing is suppressed. A non-null range always contains the
 * caret, so callers only need a null check.
 */
export function nextSuppressed(
  tr: Transaction,
  prev: null | SuppressedRange,
  caret: number,
): null | SuppressedRange {
  if (tr.docChanged) {
    if (tr.getMeta(SYNTAX_REVEAL_EPHEMERAL_META) === true) {
      return (
        changedRanges(tr).find((r) => caret >= r.from && caret <= r.to) ?? null
      );
    }
    return { from: caret, to: caret };
  }
  if (!prev) return null;
  return caret >= prev.from && caret <= prev.to ? prev : null;
}

// Regex to parse expanded wikilink text: [[alias::target#heading^blockId|display]]
export const WIKILINK_REGEX =
  /^\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]$/;
