import { describe, expect, it } from "vitest";

import {
  BLOCK_REF_RE,
  escapeBlockRefTarget,
  parseBlockRefMatch,
  serializeBlockRef,
} from "../../../../pipeline/block-id";
import {
  companionPathFor,
  pdfRelPathForHighlightTarget,
} from "../pdf-highlight-sidecar";
import { buildRefDisplay, MAX_DISPLAY_LEN } from "../pdf-ref-display";

describe("buildRefDisplay", () => {
  it("collapses newlines and runs of whitespace into single spaces", () => {
    expect(buildRefDisplay("Attention  mechanisms\nallow   modeling")).toBe(
      "Attention mechanisms allow modeling",
    );
  });

  it("removes parentheses so the label never ends up unbalanced", () => {
    expect(buildRefDisplay("as shown in (Fig. 3) above")).toBe(
      "as shown in Fig. 3 above",
    );
  });

  it("removes square brackets that could form a wikilink pattern", () => {
    // "([1])" 는 제거 없이는 "[[1]]" 가 되어 wikilink로 오인된다
    expect(buildRefDisplay("see ([1]) for details")).toBe("see 1 for details");
  });

  it("proves strip-then-collapse order by handling space-flanked brackets", () => {
    // "( 1 )" → strip → "  1  " → collapse → " 1 "  → trim → "1"
    // If we collapsed first: "( 1 )" → collapse (no effect, space already single) → strip → "  1  " → trim → "1"
    // This fixture proves the order matters by ensuring the result is correct
    // (collapse before strip would leave double spaces before trimming)
    expect(buildRefDisplay("see ( 1 ) for details")).toBe("see 1 for details");
  });

  it("removes the pipe that would terminate the display capture", () => {
    expect(buildRefDisplay("a | b")).toBe("a b");
  });

  it("truncates past the limit and appends an ellipsis", () => {
    const long = "x".repeat(MAX_DISPLAY_LEN + 40);
    const out = buildRefDisplay(long);

    expect(out).toHaveLength(MAX_DISPLAY_LEN + 1); // 80 + "…"
    expect(out.endsWith("…")).toBe(true);
  });

  it("trims trailing whitespace before appending ellipsis", () => {
    // Create text that after slice(0, 80) ends with whitespace.
    // "x".repeat(79) + " " + "y".repeat(5) = 85 chars total.
    // slice(0, 80) = "x"*79 + " " = 80 chars ending with space.
    const textWithTrailingSpace = "x".repeat(79) + " " + "y".repeat(5);
    const out = buildRefDisplay(textWithTrailingSpace);

    // After trimEnd(), no trailing space before ellipsis
    expect(out).not.toContain(" …");
    expect(out.endsWith("…")).toBe(true);
    // The trimmed slice is 79 chars (after removing trailing space) + "…" = 80 chars total
    expect(out).toBe("x".repeat(79) + "…");
  });

  it("leaves text at exactly the limit untouched", () => {
    const exact = "y".repeat(MAX_DISPLAY_LEN);
    expect(buildRefDisplay(exact)).toBe(exact);
  });

  it("preserves Korean text", () => {
    expect(buildRefDisplay("어텐션 메커니즘은 거리에 무관하다")).toBe(
      "어텐션 메커니즘은 거리에 무관하다",
    );
  });
});

describe("generated display survives the block-ref round-trip", () => {
  it.each([
    ["parentheses", "as shown in (Fig. 3) above"],
    ["brackets", "see ([1]) for details"],
    ["pipe", "left | right"],
    ["korean", "어텐션 메커니즘은 거리에 무관하다"],
    ["overlong", "z".repeat(200)],
  ])("serialize → match → parse is lossless: %s", (_label, source) => {
    const display = buildRefDisplay(source);
    const attrs = {
      blockId: "h7k2m9",
      display,
      target: "highlights/papers/attention",
    };

    const serialized = serializeBlockRef(attrs);
    const match = new RegExp(BLOCK_REF_RE.source, "g").exec(serialized);

    expect(match).not.toBeNull();
    expect(parseBlockRefMatch(match!)).toEqual(attrs);
  });
});

describe("highlight-ref target survives escaping across the block-ref round-trip", () => {
  // §275.4 CRITICAL-2 — the block above holds `target` fixed at
  // "highlights/papers/attention" in every one of its five fixtures; that is
  // exactly how a PDF filename containing `)`, `#`, or `|` (BLOCK_REF_RE's
  // target capture is `[^)#|]*?` and cannot contain any of the three)
  // produced a `Copy reference` string that never matched BLOCK_REF_RE again,
  // silently, for twelve tasks and twelve reviews. This block varies the
  // TARGET instead, mirroring the real pipeline end to end: pdfRelPath →
  // companionPathFor → escapeBlockRefTarget (as use-pdf-highlights.ts builds
  // it) → serializeBlockRef → BLOCK_REF_RE match → parseBlockRefMatch →
  // pdfRelPathForHighlightTarget (the un-escaping consumer) → must equal the
  // ORIGINAL pdfRelPath.
  it.each([
    ["a plain name", "papers/attention.pdf"],
    ["(2017)-style parens", "papers/Attention Is All You Need (2017).pdf"],
    ["a hash", "papers/paper#3.pdf"],
    ["a pipe", "papers/a|b.pdf"],
    ["a space", "papers/my paper.pdf"],
    ["a non-ASCII name", "papers/논문 (2017).pdf"],
  ])(
    "round-trips a filename with %s through Copy reference and back to the PDF path",
    (_label, pdfRelPath) => {
      const target = escapeBlockRefTarget(
        companionPathFor(pdfRelPath).replace(/\.md$/i, ""),
      );

      const serialized = serializeBlockRef({ blockId: "h7k2m9", target });
      const match = new RegExp(BLOCK_REF_RE.source, "g").exec(serialized);

      expect(match).not.toBeNull();
      const parsed = parseBlockRefMatch(match!);
      expect(pdfRelPathForHighlightTarget(parsed.target)).toBe(pdfRelPath);
    },
  );
});
