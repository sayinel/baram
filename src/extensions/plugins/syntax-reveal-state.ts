// §5.1 + §3.3 Syntax Reveal — state types, PluginKey, and shared helpers

import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { PluginKey } from "@tiptap/pm/state";

// ── Plugin state ──────────────────────────────────────────────────────

export interface ExpandedRange {
  closeCheck?: string; // closing delimiter to validate (marks only)
  from: number; // start of expanded text (for images: inside paragraph)
  kind: "image" | "link" | "mark" | "wikilink";
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
}

export const INACTIVE: SyntaxRevealState = { expanded: null };
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
  const { from, to, kind, openCheck, closeCheck } = expanded;
  if (kind === "mark" && closeCheck) {
    return to - closeCheck.length - (from + openCheck.length);
  }
  if (kind === "link") {
    try {
      const fullText = state.doc.textBetween(from, to);
      const bracketIdx = fullText.indexOf("](");
      return bracketIdx >= 0 ? bracketIdx - 1 : 0;
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

// Regex to parse expanded wikilink text: [[alias::target#heading^blockId|display]]
export const WIKILINK_REGEX =
  /^\[\[(?:([a-zA-Z][\w-]*)::)?([^\]|#^]+)(?:#([^\]|^]+))?(?:\^([^\]|]+))?(?:\|([^\]]+))?\]\]$/;
