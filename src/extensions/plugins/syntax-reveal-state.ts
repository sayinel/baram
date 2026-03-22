// §5.1 + §3.3 Syntax Reveal — state types, PluginKey, and shared helpers

import type { Node as PmNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";

import { PluginKey } from "@tiptap/pm/state";

// ── Plugin state ──────────────────────────────────────────────────────

export interface ExpandedRange {
  closeCheck?: string; // closing delimiter to validate (marks only)
  from: number; // start of expanded text (for images: inside paragraph)
  kind: "image" | "link" | "mark" | "wikilink";
  markName?: string; // for marks: "bold", "italic", etc.
  openCheck: string; // opening delimiter to validate
  to: number; // end of expanded text
}

export interface SyntaxRevealState {
  expanded: ExpandedRange | null;
}

export const INACTIVE: SyntaxRevealState = { expanded: null };
export const syntaxRevealKey = new PluginKey<SyntaxRevealState>("syntaxReveal");

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
