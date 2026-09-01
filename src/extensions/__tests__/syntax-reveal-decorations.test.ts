import type { ExpandedRange } from "../plugins/syntax-reveal-state";

// §384 fix (F1 round 2) — BLOCKER: buildExpandedDecorations is one of the
// five production consumers of parseRevealResource's labelEnd option (see
// syntax-reveal-resource-codec.ts's doc comment on why a text-only search can
// mis-split a destination that itself contains a literal `](`), but had no
// dedicated test file at all — a future refactor could silently drop the
// `labelEnd` argument at syntax-reveal-decorations.ts and nothing would go
// red. This pins it directly against the same reviewer counterexample used
// in syntax-reveal.test.ts and syntax-reveal-resource-codec.test.ts.
import { Editor } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createBaramExtensions } from "../../extensions";
import { getSyntaxRevealExpanded } from "../plugins/syntax-reveal";
import { buildExpandedDecorations } from "../plugins/syntax-reveal-decorations";

function createEditor(): Editor {
  return new Editor({ extensions: createBaramExtensions(), content: "" });
}

/**
 * Move cursor to a position that clears the cursorAtDocChange guard, then
 * move to the target position — same two-step dance syntax-reveal.test.ts
 * uses to make the plugin's expansion checks actually run.
 */
function moveCursorTo(
  editor: Editor,
  guardPos: number,
  targetPos: number,
): void {
  editor.commands.setTextSelection(guardPos);
  editor.commands.setTextSelection(targetPos);
}

describe("buildExpandedDecorations (§384 F1 round 2)", () => {
  it("styles ](destination) starting at the TRUE label boundary, not the ambiguous legacy split", () => {
    const editor = createEditor();
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            {
              type: "text",
              text: "xy",
              marks: [{ type: "link", attrs: { href: " a](b", title: null } }],
            },
            { type: "text", text: " end" },
          ],
        },
      ],
    });
    moveCursorTo(editor, 2, 8);
    expect(editor.state.doc.textContent).toContain("[xy](< a](b>)");

    const expanded = getSyntaxRevealExpanded(editor.state);
    expect(expanded?.kind).toBe("link");
    // "Hello " (1-7) + "[" at 7 + "xy" (8-10) + "]" at 10.
    expect(expanded?.from).toBe(7);
    expect(expanded?.labelEnd).toBe(10);

    const decos = buildExpandedDecorations(
      editor.state,
      expanded as ExpandedRange,
    );

    expect(decos).toHaveLength(2);
    expect(decos[0].from).toBe(7); // "[" opening delimiter
    expect(decos[0].to).toBe(8);
    // The legacy greedy search would mis-split this exact destination at the
    // destination's OWN embedded "](" (from + 8 = 15, inside "< a](b>)")
    // instead of the real label boundary (from + 3 = 10) — see the codec
    // test's "legacy search mis-splits" pin for the same string.
    expect(decos[1].from).toBe(10);
    expect(decos[1].to).toBe(expanded?.to);

    editor.destroy();
  });

  it("returns no decorations for a stale expansion (delimiters no longer validate)", () => {
    const editor = createEditor();
    editor.commands.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    });

    // Fabricated stale range — never came from a real expansion.
    const staleExpanded: ExpandedRange = {
      kind: "link",
      from: 1,
      to: 6,
      openCheck: "[",
      labelEnd: 3,
    };

    const decos = buildExpandedDecorations(editor.state, staleExpanded);
    expect(decos).toEqual([]);
    editor.destroy();
  });
});
