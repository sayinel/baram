import { Editor } from "@tiptap/core";
// §5.1 + §3.3 Syntax Reveal — expansion / collapse integration tests
// Tests that the SyntaxReveal plugin inserts/removes markdown delimiters
// when the cursor enters/exits a mark or link range.
import { describe, expect, it, vi } from "vitest";

// link.ts's Cmd+click "Strategy 3" navigates a scheme-less href straight to
// the OS opener when onNavigateLocal declines it (the default here, since
// createBaramExtensions() isn't given one) — mock it so that call is inert.
const { openUrl } = vi.hoisted(() => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl }));

import type { ExpandedRange } from "../plugins/syntax-reveal-state";

import { createBaramExtensions } from "../../extensions";
import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import {
  forceCollapseSyntaxReveal,
  getSyntaxRevealExpanded,
} from "../plugins/syntax-reveal";
import {
  buildCollapseTr,
  collapseExpanded,
} from "../plugins/syntax-reveal-collapse";

function createEditor(): Editor {
  return new Editor({
    extensions: createBaramExtensions(),
    content: "",
  });
}

/** Load markdown into editor via the pipeline */
function loadMarkdown(editor: Editor, md: string): void {
  const doc = markdownToProsemirror(md, editor.schema);
  editor.commands.setContent(doc.toJSON());
}

/**
 * Move cursor to a position that clears the cursorAtDocChange guard,
 * then move to the target position. This two-step sequence ensures
 * the syntax-reveal plugin's expansion checks actually run.
 */
function moveCursorTo(
  editor: Editor,
  guardPos: number,
  targetPos: number,
): void {
  editor.commands.setTextSelection(guardPos);
  editor.commands.setTextSelection(targetPos);
}

describe("Syntax Reveal (§5.1)", () => {
  describe("Mark expansion", () => {
    it("bold: cursor entering inserts ** delimiters", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello **world** end\n");
      // "Hello " (pos 1-7), "world" bold (pos 7-12), " end" (pos 12-16)
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain("**world**");
      editor.destroy();
    });

    it("italic: cursor entering inserts * delimiters", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello *world* end\n");
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain("*world*");
      // Ensure single * not double **
      expect(editor.state.doc.textContent).not.toContain("**");
      editor.destroy();
    });

    it("code: cursor entering inserts ` delimiters", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello `world` end\n");
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain("`world`");
      editor.destroy();
    });

    it("strike: cursor entering inserts ~~ delimiters", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello ~~world~~ end\n");
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain("~~world~~");
      editor.destroy();
    });
  });

  describe("Link expansion", () => {
    it("cursor entering link inserts [text](url) syntax", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello [world](https://example.com) end\n");
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain(
        "[world](https://example.com)",
      );
      editor.destroy();
    });
  });

  describe("Collapse", () => {
    it("cursor exiting expanded bold restores mark", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello **world** end\n");

      // Step 1: expand
      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("**world**");

      // Step 2: move cursor out (triggers collapse via appendTransaction)
      editor.commands.setTextSelection(2);
      expect(editor.state.doc.textContent).not.toContain("**");
      expect(editor.state.doc.textContent).toContain("world");

      // Verify bold mark is restored
      const para = editor.state.doc.firstChild!;
      let hasBold = false;
      para.descendants((child) => {
        if (child.marks.some((m) => m.type.name === "bold")) {
          hasBold = true;
        }
      });
      expect(hasBold).toBe(true);

      editor.destroy();
    });

    it("cursor exiting expanded link restores link mark", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello [world](https://example.com) end\n");

      // Expand
      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain(
        "[world](https://example.com)",
      );

      // Collapse
      editor.commands.setTextSelection(2);
      expect(editor.state.doc.textContent).not.toContain("[world]");

      // Verify link mark restored
      const para = editor.state.doc.firstChild!;
      let hasLink = false;
      para.descendants((child) => {
        if (child.marks.some((m) => m.type.name === "link")) {
          hasLink = true;
        }
      });
      expect(hasLink).toBe(true);

      editor.destroy();
    });
  });

  describe("No expansion", () => {
    it("cursor on non-marked text produces no delimiters", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello **world** end\n");
      // Move to "Hello" area (no marks)
      moveCursorTo(editor, 3, 4);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      editor.destroy();
    });

    it("empty document produces no errors", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello world\n");
      moveCursorTo(editor, 2, 5);

      expect(editor.state.doc.textContent).toBe("Hello world");
      editor.destroy();
    });
  });

  // §384 fix (B): expansion stashed only href/title, and both collapse
  // implementations recreated the mark from those two alone — so entering
  // and leaving a link erased any other mark attr (e.g. `target`). The doc
  // is built directly (not via markdown) because the markdown pipeline never
  // sets `target` on a link mark in the first place; this test needs one to
  // already exist on the mark to prove it survives the round trip.
  describe("Link attrs preserved through expand/collapse (§384 B)", () => {
    function loadLinkWithTarget(editor: Editor): void {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              {
                type: "text",
                text: "world",
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: "https://example.com",
                      title: null,
                      target: "_blank",
                    },
                  },
                ],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });
    }

    it("survives forceCollapseSyntaxReveal", () => {
      const editor = createEditor();
      loadLinkWithTarget(editor);

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain(
        "[world](https://example.com)",
      );

      forceCollapseSyntaxReveal(editor.view);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("https://example.com");
      expect(linkMark?.attrs.target).toBe("_blank");
      editor.destroy();
    });

    it("survives the appendTransaction cursor-exit collapse path", () => {
      const editor = createEditor();
      loadLinkWithTarget(editor);

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain(
        "[world](https://example.com)",
      );

      // Cursor leaves the expanded range → appendTransaction's own,
      // independent collapse branch runs (not forceCollapseSyntaxReveal).
      editor.commands.setTextSelection(2);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("https://example.com");
      expect(linkMark?.attrs.target).toBe("_blank");
      editor.destroy();
    });
  });

  // §384 fix (B2): expansion printed the href raw and both collapse
  // implementations matched destinations with `\S+?` — a destination
  // containing whitespace (e.g. href="a b", exactly what `[x](<a b>)` parses
  // to) printed as `[world](a b)` on expand and then could never collapse
  // back: `\S+?` doesn't match "a b", so the literal delimiters were left
  // behind permanently. The reveal resource codec fixes both sides: expand
  // now emits the angle-bracket form, and collapse can parse it back.
  describe("Link destination with whitespace round-trips (§384 B2)", () => {
    function loadLinkWithSpaceHref(editor: Editor): void {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              {
                type: "text",
                text: "world",
                marks: [{ type: "link", attrs: { href: "a b", title: null } }],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });
    }

    it("expands to the angle-bracket form and collapses back via forceCollapseSyntaxReveal", () => {
      const editor = createEditor();
      loadLinkWithSpaceHref(editor);

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("[world](<a b>)");

      forceCollapseSyntaxReveal(editor.view);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("a b");
      editor.destroy();
    });

    it("expands to the angle-bracket form and collapses back via the appendTransaction cursor-exit path", () => {
      const editor = createEditor();
      loadLinkWithSpaceHref(editor);

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("[world](<a b>)");

      editor.commands.setTextSelection(2);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("a b");
      editor.destroy();
    });

    it("escapes a literal < inside the angle-bracket destination and round-trips it", () => {
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
                text: "world",
                marks: [
                  { type: "link", attrs: { href: "a < b", title: null } },
                ],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("[world](<a \\< b>)");

      forceCollapseSyntaxReveal(editor.view);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("a < b");
      editor.destroy();
    });

    it("round-trips an empty destination with a title", () => {
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
                text: "world",
                marks: [{ type: "link", attrs: { href: "", title: "t" } }],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain('[world](<> "t")');

      forceCollapseSyntaxReveal(editor.view);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("");
      expect(linkMark?.attrs.title).toBe("t");
      editor.destroy();
    });

    // §384 fix (F4): the codec must not conflate "no title" (`null`) with
    // "an empty, present title" (`""`) — see syntax-reveal-resource-codec's
    // `title !== null` check. The expanded text itself must carry a
    // present-but-empty title section (`<> ""`), not silently drop it the
    // way the pre-fix truthiness check did (`[x]()`, indistinguishable from
    // no title at all).
    it("expands an empty-but-present title distinctly from no title (§384 F4)", () => {
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
                text: "world",
                marks: [{ type: "link", attrs: { href: "", title: "" } }],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain('[world](<> "")');

      forceCollapseSyntaxReveal(editor.view);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("");
      // Both collapse implementations build the link MARK with
      // `title: title || null` — a separate, existing normalization at the
      // mark-attrs layer (an empty title and no title read the same in the
      // UI), independent of the codec's own `title: "" !== null` inverse
      // contract this fix restores. Documented here, not changed by F4.
      expect(linkMark?.attrs.title).toBeNull();
      editor.destroy();
    });
  });

  // §384 fix (B2, follow-on): link.ts's Cmd+click handler is a THIRD parser
  // of this same expanded text (its own hand-rolled regex, "Strategy 3"),
  // used to navigate without waiting for collapse. It already handled the
  // angle-bracket form, but didn't unescape it — so once expansion started
  // emitting `<a \< b>` for an escaped destination, that regex captured the
  // escape backslash literally and navigated to the wrong place. Routed
  // through parseRevealResource so all three parsers agree.
  describe("Cmd+click navigation on an expanded link unescapes the destination (§384 B2)", () => {
    it("navigates to the unescaped destination, not the raw escape sequence", () => {
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
                text: "world",
                marks: [
                  { type: "link", attrs: { href: "a < b", title: null } },
                ],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("[world](<a \\< b>)");

      // Real DOM dispatch: link.ts's mousedown handler is registered via
      // ProseMirror's handleDOMEvents, not reachable by calling a plugin
      // prop function directly (several plugins register their own
      // mousedown handler — e.g. image.ts's click guard — and only a real
      // dispatch runs ProseMirror's actual per-plugin iteration order).
      editor.view.dom.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        }),
      );

      expect(openUrl).toHaveBeenCalledWith("a < b");
      editor.destroy();
    });
  });

  // §5.1 source-mode toggle calls forceCollapseSyntaxReveal before serializing.
  // It must collapse the literal delimiters back to a mark (no data loss) AND
  // preserve the caret's logical position inside the content — without an
  // explicit cursorTarget, ProseMirror's default mapping pushes the caret to
  // the END of the collapsed mark, which the user observed as cursor drift to
  // after the bold (and then literal **구문** corruption on the next round-trip).
  describe("forceCollapse preserves caret (source-mode toggle)", () => {
    it("bold: caret inside content stays inside after force-collapse", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello **world** end\n");
      // "Hello " = 1-7, "world" bold = 7-12, " end" = 12-16.
      // Move caret inside "world" (pos 9 = wo|rld) → plugin expands to **world**.
      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("**world**");

      forceCollapseSyntaxReveal(editor.view);

      // No data loss: literal delimiters gone, bold mark restored.
      expect(editor.state.doc.textContent).toBe("Hello world end");
      const bold = editor.state.doc
        .nodeAt(7)
        ?.marks.some((m) => m.type.name === "bold");
      expect(bold).toBe(true);
      // Caret preserved inside "world" (pos 9), NOT pushed to after the bold (12).
      expect(editor.state.selection.from).toBe(9);
      editor.destroy();
    });

    it("bold: caret at trailing boundary collapses to after the mark", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello **world** end\n");
      moveCursorTo(editor, 2, 9); // expand → "Hello **world** end"
      // Place caret just after the closing ** (trailing boundary → stays expanded).
      // textContent "Hello **world** end": "**world**" at index 6, len 9 →
      // doc position after it = 6 + 9 + 1(content offset) = 16.
      editor.commands.setTextSelection(16);

      forceCollapseSyntaxReveal(editor.view);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      // Bold "world" ends at 12 — caret should land right after it (12), not inside.
      expect(editor.state.selection.from).toBe(12);
      editor.destroy();
    });
  });

  // §384 roundtrip: the app's own save path (serializeLiveDoc) must reproduce the
  // original bytes even while a link is actively expanded — the corruption this
  // fix closes only shows up with the caret still inside the expansion, so a
  // roundtrip test needs this file's Editor + caret harness, not the bare-schema
  // fixtures the pipeline `roundtrip*.test.ts` suite uses (no caret to place there).
  describe("Save roundtrip with the caret inside an expanded link (§384)", () => {
    it("serializeLiveDoc reproduces the original markdown byte-for-byte", () => {
      const editor = createEditor();
      const original = "Hello [world](https://example.com) end\n";
      loadMarkdown(editor, original);
      moveCursorTo(editor, 2, 9);

      expect(editor.state.doc.textContent).toContain(
        "[world](https://example.com)",
      );
      // The naive read every pre-§384 save/dirty-check call site used — shown here
      // as the roundtrip failure this fix closes, not as an assertion to keep.
      expect(prosemirrorToMarkdown(editor.state.doc)).not.toBe(original);

      expect(serializeLiveDoc(editor)).toBe(original);
      editor.destroy();
    });
  });

  // §384 fix (F1) — BLOCKER: expandLink inserts the link's LIVE doc text
  // as-is between `[` and `](href)` (it can't escape it — that would corrupt
  // the label's own marks, see expandLink), so a label containing a bare `]`
  // (e.g. from source markdown `[a\]b](u)`, which parses to live text `a]b`)
  // produced literal, unparseable expanded text (`[a]b](u)`) that BOTH
  // collapse paths rejected — falling back to canonicalDoc's stale-doc branch
  // and corrupting the save. Reproduced here through a real Editor, matching
  // the exact repro in the review verdict.
  describe("Link label containing an unescaped ] round-trips (§384 F1)", () => {
    const original = "Hello [a\\]b](u) end\n";

    it("caret-in: expands to the literal (unescaped) label and serializeLiveDoc still reproduces the original", () => {
      const editor = createEditor();
      loadMarkdown(editor, original);
      moveCursorTo(editor, 2, 8);

      expect(editor.state.doc.textContent).toContain("[a]b](u)");
      expect(serializeLiveDoc(editor)).toBe(original);
      editor.destroy();
    });

    it("forceCollapseSyntaxReveal restores the link mark with the original label and href", () => {
      const editor = createEditor();
      loadMarkdown(editor, original);
      moveCursorTo(editor, 2, 8);
      expect(editor.state.doc.textContent).toContain("[a]b](u)");

      forceCollapseSyntaxReveal(editor.view);

      expect(editor.state.doc.textContent).toBe("Hello a]b end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("u");
      expect(serializeLiveDoc(editor)).toBe(original);
      editor.destroy();
    });

    it("the appendTransaction cursor-exit path restores the link mark with the original label and href", () => {
      const editor = createEditor();
      loadMarkdown(editor, original);
      moveCursorTo(editor, 2, 8);
      expect(editor.state.doc.textContent).toContain("[a]b](u)");

      editor.commands.setTextSelection(2);

      expect(editor.state.doc.textContent).toBe("Hello a]b end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("u");
      expect(serializeLiveDoc(editor)).toBe(original);
      editor.destroy();
    });

    // §384 (design review M2): every production call site derives its
    // parseRevealResource `labelEnd` option from the stashed
    // `ExpandedRange.labelEnd` — but the field is optional (`labelEnd?:
    // number`), and if that stash is ever absent, the fallback used to be
    // `undefined` (the STRICT/serialized grammar). Strict cannot parse a
    // bare, unescaped `]` in the label — the exact F1 corruption this
    // describe block is named for — so an emergency path with no stash would
    // silently reopen it. Simulates the stash going missing by deleting
    // `labelEnd` from a real, otherwise-valid `ExpandedRange` and driving
    // `buildCollapseTr` directly (the collapse-path entry point every other
    // caller in this fix routes through).
    it("buildCollapseTr still collapses via the live label grammar when the labelEnd stash is missing", () => {
      const editor = createEditor();
      loadMarkdown(editor, original);
      moveCursorTo(editor, 2, 8);
      const expanded = getSyntaxRevealExpanded(editor.state);
      expect(expanded).not.toBeNull();
      expect(expanded!.labelEnd).toBeDefined();

      const withoutStash: ExpandedRange = {
        ...expanded!,
        labelEnd: undefined,
      };
      const tr = buildCollapseTr(editor.state, withoutStash);

      expect(tr).not.toBeNull();
      expect(tr!.doc.textContent).toBe("Hello a]b end");
      const linkMark = tr!.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("u");
      editor.destroy();
    });
  });

  // §384 fix (F2): a destination containing Unicode (non-ASCII) whitespace —
  // e.g. U+00A0 NBSP — serializes to the RAW (non-angle) form (NEEDS_ANGLE_RE
  // is ASCII-only), but the old RAW_DEST_CONTENT pattern excluded ALL JS `\s`
  // (Unicode-inclusive), so parsing that exact raw form failed. Broke both
  // collapse paths and Cmd+click Strategy 3 identically to F1's label bug.
  describe("Link destination with Unicode whitespace round-trips (§384 F2)", () => {
    function loadLinkWithNbspHref(editor: Editor): void {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Hello " },
              {
                type: "text",
                text: "world",
                marks: [{ type: "link", attrs: { href: "a b", title: null } }],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });
    }

    it("expands to the raw (non-angle) form and collapses back via forceCollapseSyntaxReveal", () => {
      const editor = createEditor();
      loadLinkWithNbspHref(editor);

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("[world](a b)");

      forceCollapseSyntaxReveal(editor.view);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("a b");
      editor.destroy();
    });

    it("expands and collapses back via the appendTransaction cursor-exit path", () => {
      const editor = createEditor();
      loadLinkWithNbspHref(editor);

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("[world](a b)");

      editor.commands.setTextSelection(2);

      expect(editor.state.doc.textContent).toBe("Hello world end");
      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark?.attrs.href).toBe("a b");
      editor.destroy();
    });

    it("Cmd+click navigates to the Unicode-whitespace destination instead of declining (link.ts Strategy 3)", () => {
      const editor = createEditor();
      loadLinkWithNbspHref(editor);

      moveCursorTo(editor, 2, 9);
      expect(editor.state.doc.textContent).toContain("[world](a b)");

      editor.view.dom.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        }),
      );

      expect(openUrl).toHaveBeenCalledWith("a b");
      editor.destroy();
    });
  });

  // §384 fix (R3-1) — CRITICAL: a destination beginning with `<` has no ASCII
  // whitespace/control char, so `serializeDestination` used to emit it RAW
  // (only `(`/`)` escaped) — indistinguishable from real angle-bracket
  // wrapping. Expand-then-collapse alone (no markdown save/reload involved)
  // therefore silently rewrote the href: `"<a>"` collapsed back as `"a"`,
  // `"<>"` collapsed back as `""`. Built via `setContent` with an explicit
  // link mark (not markdown source), same reasoning as the block below: pins
  // the reveal codec's own round trip, independent of the canonical markdown
  // serializer (which has a separate, pre-existing issue with this same
  // family of destinations — see the codec's file-header comment; not this
  // commit's scope).
  describe("Link destination beginning with < is not corrupted by expand+collapse (§384 R3-1)", () => {
    function loadLinkWithHref(editor: Editor, href: string): void {
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
                marks: [{ type: "link", attrs: { href, title: null } }],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });
    }

    for (const href of ["<a>", "<>", '<a> "b"']) {
      describe(`destination ${JSON.stringify(href)}`, () => {
        it("forceCollapseSyntaxReveal restores the original href", () => {
          const editor = createEditor();
          loadLinkWithHref(editor, href);
          moveCursorTo(editor, 2, 8);
          expect(editor.state.doc.textContent).toContain("[xy](");

          forceCollapseSyntaxReveal(editor.view);

          const linkMark = editor.state.doc
            .nodeAt(7)
            ?.marks.find((m) => m.type.name === "link");
          expect(linkMark?.attrs.href).toBe(href);
          editor.destroy();
        });

        it("the appendTransaction cursor-exit path restores the original href", () => {
          const editor = createEditor();
          loadLinkWithHref(editor, href);
          moveCursorTo(editor, 2, 8);

          editor.commands.setTextSelection(2);

          const linkMark = editor.state.doc
            .nodeAt(7)
            ?.marks.find((m) => m.type.name === "link");
          expect(linkMark?.attrs.href).toBe(href);
          editor.destroy();
        });
      });
    }
  });

  // §384 fix (R3-2): Strategy 1 (rendered `<a>`) and Strategy 2 (ProseMirror
  // mark, resolved from DOM coords) both navigate the href VERBATIM. Strategy
  // 3 (SyntaxReveal expanded text, this describe block) used to call
  // `navigateHref(href.trim())` — the ONLY one of the three that trimmed —
  // so the exact same link navigated to a DIFFERENT destination depending on
  // which strategy's click handler happened to catch the event. A leading
  // space is an unusual but real href (e.g. paired with the R3-1/F1-round-2
  // family above, where the destination legitimately isn't trimmed anywhere
  // else in the pipeline).
  describe("Cmd+click preserves leading whitespace in the destination, same as the other strategies (§384 R3-2)", () => {
    it("navigates to the destination with its leading space intact, not trimmed", () => {
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
                marks: [
                  { type: "link", attrs: { href: " a](b", title: null } },
                ],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });

      moveCursorTo(editor, 2, 8);
      expect(editor.state.doc.textContent).toContain("[xy](< a](b>)");

      editor.view.dom.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          metaKey: true,
        }),
      );

      expect(openUrl).toHaveBeenCalledWith(" a](b");
      editor.destroy();
    });
  });

  // §384 fix (F1 round 2) — BLOCKER: the label/destination split was found by
  // a greedy-then-backtrack search over TEXT ALONE, trying the LONGEST label
  // first. That search cannot tell "the label legitimately contains `](`"
  // apart from "the destination does" — an angle-form destination may itself
  // contain a literal `](` (angle form only escapes `<`/`>`), so the search
  // can back off PAST the real label boundary and swallow part of the
  // destination into the label. Review counterexample: href " a](b" (or,
  // without the leading space, "a](b") serializes to `[x](< a](b>)` /
  // `[x](<a](b>)`, and the old text-only search resolves that as label
  // "x](< a" / destination "b>" instead of the real label "x" / destination
  // " a](b". Built via `setContent` with an explicit link mark (not markdown
  // source) so this pins the codec split itself, independent of whether the
  // destination also round-trips through the markdown parser.
  describe("Link destination containing a literal ]( does not corrupt the label split (§384 F1 round 2)", () => {
    function loadLinkWithHref(editor: Editor, href: string): void {
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
                marks: [{ type: "link", attrs: { href, title: null } }],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });
    }

    // "a](b" (no leading/inner space) is the no-space variant this file's own
    // comment above claims is part of the same family — it wasn't actually in
    // this loop until this fix. It takes the RAW (non-angle) destination
    // form (no ASCII whitespace to force angle — see serializeDestination),
    // so it round-trips unambiguously even via the legacy search; kept here
    // for parity with the comment and as a guard against future regressions
    // narrowing this loop's coverage.
    for (const href of [" a](b", "a]( b", "a](b"]) {
      describe(`destination ${JSON.stringify(href)}`, () => {
        it("caret-in: serializeLiveDoc still reproduces the original", () => {
          const editor = createEditor();
          loadLinkWithHref(editor, href);
          const original = serializeLiveDoc(editor);

          moveCursorTo(editor, 2, 8);
          expect(editor.state.doc.textContent).toContain("[xy](");

          expect(serializeLiveDoc(editor)).toBe(original);
          editor.destroy();
        });

        it("forceCollapseSyntaxReveal restores the original href", () => {
          const editor = createEditor();
          loadLinkWithHref(editor, href);
          moveCursorTo(editor, 2, 8);

          forceCollapseSyntaxReveal(editor.view);

          const linkMark = editor.state.doc
            .nodeAt(7)
            ?.marks.find((m) => m.type.name === "link");
          expect(linkMark?.attrs.href).toBe(href);
          editor.destroy();
        });

        it("the appendTransaction cursor-exit path restores the original href", () => {
          const editor = createEditor();
          loadLinkWithHref(editor, href);
          moveCursorTo(editor, 2, 8);

          editor.commands.setTextSelection(2);

          const linkMark = editor.state.doc
            .nodeAt(7)
            ?.marks.find((m) => m.type.name === "link");
          expect(linkMark?.attrs.href).toBe(href);
          editor.destroy();
        });
      });
    }
  });

  // §384 fix (F1 round 2): the stashed label boundary (`ExpandedRange.labelEnd`)
  // must be TRACKED through live edits inside the label — not just captured
  // once at expand time — via the same `tr.mapping.map` that already keeps
  // `from`/`to` correct in `apply()`. Uses the SAME ambiguous angle
  // destination as the tests above so the only way to resolve the split
  // correctly after the label's length changes is via a boundary that moved
  // WITH the edit, not one re-derived from the (still ambiguous) text alone.
  describe("Editing the label text while expanded keeps the stashed boundary correct (§384 F1 round 2)", () => {
    it("typing inside the expanded label collapses with the NEW label and the correct href", () => {
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
                marks: [
                  { type: "link", attrs: { href: " a](b", title: null } },
                ],
              },
              { type: "text", text: " end" },
            ],
          },
        ],
      });
      moveCursorTo(editor, 2, 8);
      expect(editor.state.doc.textContent).toContain("[xy](< a](b>)");

      // Move the cursor to just before the closing "]" (end of the label,
      // still inside the expanded range) and type there.
      // "Hello " (1-7) + "[" (7) + "xy" (8-10) + "]" at 10.
      editor.commands.setTextSelection(10);
      editor.commands.insertContent("!!!");
      expect(editor.state.doc.textContent).toContain("[xy!!!](< a](b>)");

      // Cursor still inside the expanded range → still active, not stale.
      expect(getSyntaxRevealExpanded(editor.state)).not.toBeNull();

      editor.commands.setTextSelection(2);

      const linkMark = editor.state.doc
        .nodeAt(7)
        ?.marks.find((m) => m.type.name === "link");
      expect(linkMark).toBeDefined();
      expect(editor.state.doc.textBetween(7, 7 + "xy!!!".length)).toBe("xy!!!");
      expect(linkMark?.attrs.href).toBe(" a](b");
      editor.destroy();
    });
  });

  // §384 (C): `collapseExpanded` (the interactive wrapper around the pure
  // `buildCollapseTr`) must fall back to a meta-only INACTIVE dispatch —
  // touching neither doc nor selection — when the expansion is stale (its
  // delimiters no longer validate against the live doc), instead of
  // corrupting the doc or throwing. The extraction in commit `a3c1f304`
  // preserved this path but no test pinned it directly.
  describe("Stale expansion falls back to a meta-only INACTIVE dispatch (§384 C)", () => {
    it("collapseExpanded leaves doc and selection untouched and clears the expanded state", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello world end\n");
      editor.commands.setTextSelection(3);

      // Fabricated stale range: the doc has no "**" at position 1 at all —
      // this never came from a real expansion, simulating a caller holding
      // an ExpandedRange captured before some other edit invalidated it.
      const staleExpanded: ExpandedRange = {
        kind: "mark",
        markName: "bold",
        from: 1,
        to: 6,
        openCheck: "**",
        closeCheck: "**",
      };

      const docBefore = editor.state.doc;
      const selectionBefore = editor.state.selection;

      collapseExpanded(editor.view, staleExpanded);

      expect(editor.state.doc).toBe(docBefore);
      expect(editor.state.selection.from).toBe(selectionBefore.from);
      expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
      editor.destroy();
    });

    // §384 fix (F1 round 2): a `labelEnd` that no longer points at a real
    // `](` (e.g. the label's length changed since it was stashed, and the
    // caller failed to remap it — see ExpandedRange.labelEnd) must degrade
    // through this SAME contract, not corrupt the doc or silently reuse the
    // ambiguous legacy search.
    it("a labelEnd that no longer points at ]( falls back to INACTIVE without corrupting the doc", () => {
      const editor = createEditor();
      loadMarkdown(editor, "Hello [world](https://example.com) end\n");
      moveCursorTo(editor, 2, 9);
      const realExpanded = getSyntaxRevealExpanded(editor.state);
      expect(realExpanded?.kind).toBe("link");
      expect(realExpanded?.labelEnd).toBeDefined();

      // Simulate drift: the stashed labelEnd is off by one, so it no longer
      // lands on the real "]".
      const staleExpanded: ExpandedRange = {
        ...(realExpanded as ExpandedRange),
        labelEnd: (realExpanded as ExpandedRange).labelEnd! + 1,
      };

      const docBefore = editor.state.doc;
      const selectionBefore = editor.state.selection;

      collapseExpanded(editor.view, staleExpanded);

      expect(editor.state.doc).toBe(docBefore);
      expect(editor.state.selection.from).toBe(selectionBefore.from);
      expect(getSyntaxRevealExpanded(editor.state)).toBeNull();
      editor.destroy();
    });
  });
});
