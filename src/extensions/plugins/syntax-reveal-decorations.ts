// §5.1 + §3.3 Syntax Reveal — decoration building helpers

import type { ExpandedRange } from "./syntax-reveal-state";
import type { EditorState } from "@tiptap/pm/state";

import { Decoration } from "@tiptap/pm/view";

// ── Build delimiter decorations for expanded range ────────────────────

export function buildExpandedDecorations(
  state: EditorState,
  expanded: ExpandedRange,
): Decoration[] {
  const { from, to, kind, openCheck, closeCheck } = expanded;
  const decos: Decoration[] = [];

  try {
    if (kind === "mark" && closeCheck) {
      // Style opening delimiter
      decos.push(
        Decoration.inline(from, from + openCheck.length, {
          class: "syntax-delimiter-inline",
        }),
      );
      // Style closing delimiter
      decos.push(
        Decoration.inline(to - closeCheck.length, to, {
          class: "syntax-delimiter-inline",
        }),
      );
    } else if (kind === "link" || kind === "image") {
      const text = state.doc.textBetween(from, to);
      const closeBracket = text.indexOf("](");
      const openLen = kind === "image" ? 2 : 1;

      if (closeBracket >= 0) {
        // Style opening delimiter
        decos.push(
          Decoration.inline(from, from + openLen, {
            class: "syntax-delimiter-inline",
          }),
        );
        // Style "](url)" portion
        decos.push(
          Decoration.inline(from + closeBracket, to, {
            class: "syntax-delimiter-inline",
          }),
        );
      }
    } else if (kind === "wikilink" && closeCheck) {
      // Style [[ and ]]
      decos.push(
        Decoration.inline(from, from + openCheck.length, {
          class: "syntax-delimiter-inline",
        }),
      );
      decos.push(
        Decoration.inline(to - closeCheck.length, to, {
          class: "syntax-delimiter-inline",
        }),
      );
    }
  } catch {
    // Position out of range, skip
  }

  return decos;
}
