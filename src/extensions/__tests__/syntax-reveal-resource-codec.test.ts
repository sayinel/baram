// §384 (B2) — reveal resource codec unit tests.
//
// Pins the escaping/angle-bracket grammar shared by link+media expansion and
// both collapse implementations. Before this codec existed, expansion printed
// destinations raw and collapse matched them with `\S+?` — any destination
// containing whitespace (the exact shape produced by `[x](<a b>)`) could
// never round-trip: `[x](a b)` -- (raw, no angle brackets) -- was left behind
// as literal, uncollapsible text forever.
import { describe, expect, it } from "vitest";

import {
  parseRevealResource,
  type RevealResource,
  serializeRevealResource,
} from "../plugins/syntax-reveal-resource-codec";

describe("syntax-reveal-resource-codec (§384 B2)", () => {
  describe("serializeRevealResource", () => {
    it("wraps a link with a raw (non-angle) destination", () => {
      expect(
        serializeRevealResource({
          kind: "link",
          label: "x",
          destination: "https://example.com",
          title: null,
        }),
      ).toBe("[x](https://example.com)");
    });

    it("uses angle-bracket form when a link destination has whitespace", () => {
      expect(
        serializeRevealResource({
          kind: "link",
          label: "x",
          destination: "a b",
          title: null,
        }),
      ).toBe("[x](<a b>)");
    });

    it("uses angle-bracket form when an image destination has whitespace", () => {
      expect(
        serializeRevealResource({
          kind: "image",
          label: "x",
          destination: "a b",
          title: null,
        }),
      ).toBe("![x](<a b>)");
    });

    it("uses angle-bracket form for a whitespace-containing video filename", () => {
      expect(
        serializeRevealResource({
          kind: "image",
          label: "x",
          destination: "clip one.mp4",
          title: null,
        }),
      ).toBe("![x](<clip one.mp4>)");
    });

    it("empty destination with no title serializes as ()", () => {
      expect(
        serializeRevealResource({
          kind: "link",
          label: "x",
          destination: "",
          title: null,
        }),
      ).toBe("[x]()");
    });

    it("empty destination with a title serializes as <>", () => {
      expect(
        serializeRevealResource({
          kind: "link",
          label: "x",
          destination: "",
          title: "t",
        }),
      ).toBe('[x](<> "t")');
    });

    it("escapes a literal ] in the label", () => {
      expect(
        serializeRevealResource({
          kind: "link",
          label: "a]b",
          destination: "u",
          title: null,
        }),
      ).toBe("[a\\]b](u)");
    });

    it("escapes a literal ] in the alt (media)", () => {
      expect(
        serializeRevealResource({
          kind: "image",
          label: "a]b",
          destination: "x.png",
          title: null,
        }),
      ).toBe("![a\\]b](x.png)");
    });

    it("escapes a double quote inside the title", () => {
      expect(
        serializeRevealResource({
          kind: "link",
          label: "x",
          destination: "u",
          title: 'say "hi"',
        }),
      ).toBe('[x](u "say \\"hi\\"")');
    });

    it("escapes < and > inside an angle-bracket link destination", () => {
      expect(
        serializeRevealResource({
          kind: "link",
          label: "x",
          destination: "a < b",
          title: null,
        }),
      ).toBe("[x](<a \\< b>)");
    });

    it("escapes < and > inside an angle-bracket media destination", () => {
      expect(
        serializeRevealResource({
          kind: "image",
          label: "x",
          destination: "a < b",
          title: null,
        }),
      ).toBe("![x](<a \\< b>)");
    });

    it("escapes parens inside a raw destination", () => {
      expect(
        serializeRevealResource({
          kind: "link",
          label: "x",
          destination: "a(b)c",
          title: null,
        }),
      ).toBe("[x](a\\(b\\)c)");
    });
  });

  describe("parseRevealResource", () => {
    it("returns null for text that isn't a reveal resource", () => {
      expect(parseRevealResource("not a link")).toBeNull();
    });

    it("parses an angle-bracket link destination with whitespace", () => {
      expect(parseRevealResource("[x](<a b>)")).toEqual(
        expect.objectContaining({
          kind: "link",
          label: "x",
          destination: "a b",
          title: null,
        }),
      );
    });

    it("parses an angle-bracket image destination with whitespace", () => {
      expect(parseRevealResource("![x](<a b>)")).toEqual(
        expect.objectContaining({
          kind: "image",
          label: "x",
          destination: "a b",
          title: null,
        }),
      );
    });

    it("parses a whitespace-containing video filename", () => {
      expect(parseRevealResource("![x](<clip one.mp4>)")).toEqual(
        expect.objectContaining({
          kind: "image",
          label: "x",
          destination: "clip one.mp4",
          title: null,
        }),
      );
    });

    it("parses an empty destination with no title", () => {
      expect(parseRevealResource("[x]()")).toEqual(
        expect.objectContaining({
          kind: "link",
          label: "x",
          destination: "",
          title: null,
        }),
      );
    });

    it("parses an empty destination with a title", () => {
      expect(parseRevealResource('[x](<> "t")')).toEqual(
        expect.objectContaining({
          kind: "link",
          label: "x",
          destination: "",
          title: "t",
        }),
      );
    });

    it("unescapes an escaped ] in the label back to a literal ]", () => {
      expect(parseRevealResource("[a\\]b](u)")).toEqual(
        expect.objectContaining({
          kind: "link",
          label: "a]b",
          destination: "u",
          title: null,
        }),
      );
    });

    it("unescapes an escaped ] in the alt back to a literal ] (media)", () => {
      expect(parseRevealResource("![a\\]b](x.png)")).toEqual(
        expect.objectContaining({
          kind: "image",
          label: "a]b",
          destination: "x.png",
          title: null,
        }),
      );
    });

    it("unescapes an escaped title quote", () => {
      expect(parseRevealResource('[x](u "say \\"hi\\"")')).toEqual(
        expect.objectContaining({
          kind: "link",
          label: "x",
          destination: "u",
          title: 'say "hi"',
        }),
      );
    });

    it("unescapes < inside an angle-bracket link destination", () => {
      expect(parseRevealResource("[x](<a \\< b>)")).toEqual(
        expect.objectContaining({
          kind: "link",
          label: "x",
          destination: "a < b",
          title: null,
        }),
      );
    });

    it("unescapes < inside an angle-bracket media destination", () => {
      expect(parseRevealResource("![x](<a \\< b>)")).toEqual(
        expect.objectContaining({
          kind: "image",
          label: "x",
          destination: "a < b",
          title: null,
        }),
      );
    });

    // §384 fix (F1): a link label is live doc text that expandLink never
    // escapes (see expandLink) — so a label containing a BARE, unescaped `]`
    // not immediately followed by `(` must still parse. Before this fix the
    // label grammar structurally excluded `]`, so `REVEAL_RESOURCE_RE` never
    // matched at all and this returned null.
    describe("lenient label grammar (§384 F1)", () => {
      it("parses a label containing a bare, unescaped ]", () => {
        const parsed = parseRevealResource("[a]b](u)");
        expect(parsed).toEqual(
          expect.objectContaining({
            kind: "link",
            label: "a]b",
            destination: "u",
            title: null,
          }),
        );
      });

      it("labelEnd points at the `]` that actually opens the destination group", () => {
        // "[a]b](u)" — labelEnd = index of the SECOND `]` (position 4), not
        // the first bare `]` inside the label (position 2).
        expect(parseRevealResource("[a]b](u)")?.labelEnd).toBe(4);
      });

      it("an ambiguous label resolves to the LAST split whose tail validates — documented, not a null-reject", () => {
        // "[a](b](u)" has two candidate `](` splits: after "a" (index 1) and
        // after "a](b" (index 4). The FIRST candidate's tail ("b](u)") is not
        // a valid destination — a raw destination cannot contain an
        // unescaped `(`, so "b]" is as much as RAW_DEST_CONTENT can consume,
        // leaving "(u)" unmatched before the required closing `)`. Greedy
        // backtracking tries the LONGER label first anyway and it succeeds
        // outright, so this never even reaches the shorter candidate — label
        // "a](b", destination "u". A label containing its own
        // syntactically-complete `](destination)` is genuinely ambiguous
        // with the real one; this is that case resolved one specific way
        // (longest label wins when both could parse), not a rejection.
        expect(parseRevealResource("[a](b](u)")).toEqual(
          expect.objectContaining({
            kind: "link",
            label: "a](b",
            destination: "u",
            title: null,
          }),
        );
      });

      it("an angle-form destination containing a literal ](  still parses at the real label boundary", () => {
        // Guards the failure mode a blind `lastIndexOf("](")` would introduce:
        // the destination itself contains "](" (angle form permits it — only
        // `<`/`>` are escaped there), and backtracking must still land on the
        // FIRST `](` because the second candidate's tail (" b>)") does not
        // complete a valid destination/title/`)` grammar.
        expect(parseRevealResource("[x](<a]( b>)")).toEqual(
          expect.objectContaining({
            kind: "link",
            label: "x",
            destination: "a]( b",
            title: null,
          }),
        );
      });
    });

    // §384 fix (F2): destinations containing Unicode whitespace (not just
    // ASCII) that end up in the RAW (non-angle) form must still parse — see
    // NEEDS_ANGLE_RE (ASCII-only) vs. the old RAW_DEST_CONTENT (JS `\s`,
    // Unicode-inclusive) asymmetry.
    describe("Unicode whitespace in a raw destination (§384 F2)", () => {
      it("parses a raw destination containing U+00A0 (NBSP)", () => {
        expect(parseRevealResource("[x](a b)")).toEqual(
          expect.objectContaining({
            kind: "link",
            label: "x",
            destination: "a b",
            title: null,
          }),
        );
      });

      it("parses a raw destination containing U+00A0 alongside a title", () => {
        expect(parseRevealResource('[x](a b "t")')).toEqual(
          expect.objectContaining({
            kind: "link",
            label: "x",
            destination: "a b",
            title: "t",
          }),
        );
      });
    });

    // §384 fix (F4): `title: ""` (present, empty) must parse back as `""`,
    // not `null` — that distinction is what `title !== null` (vs. truthiness)
    // in serializeRevealResource now preserves on the way in.
    describe("empty-but-present title (§384 F4)", () => {
      it("parses an empty destination with an empty title as present, not null", () => {
        expect(parseRevealResource('[x](<> "")')).toEqual(
          expect.objectContaining({
            kind: "link",
            label: "x",
            destination: "",
            title: "",
          }),
        );
      });

      it("parses a non-empty destination with an empty title as present, not null", () => {
        expect(parseRevealResource('[x](u "")')).toEqual(
          expect.objectContaining({
            kind: "link",
            label: "x",
            destination: "u",
            title: "",
          }),
        );
      });
    });
  });

  describe("round trip", () => {
    const cases: RevealResource[] = [
      {
        kind: "link",
        label: "world",
        destination: "https://example.com",
        title: null,
      },
      { kind: "link", label: "x", destination: "a b", title: null },
      { kind: "image", label: "x", destination: "a b", title: null },
      {
        kind: "image",
        label: "caption",
        destination: "clip one.mp4",
        title: null,
      },
      { kind: "link", label: "x", destination: "", title: null },
      { kind: "link", label: "x", destination: "", title: "t" },
      { kind: "link", label: "a]b", destination: "u", title: null },
      { kind: "image", label: "a]b", destination: "x.png", title: null },
      { kind: "link", label: "x", destination: "u", title: 'say "hi"' },
      { kind: "link", label: "x", destination: "a < b", title: null },
      { kind: "image", label: "x", destination: "a < b", title: null },
      { kind: "link", label: "x", destination: "a(b)c", title: null },
      // §384 fix (F2): Unicode (non-ASCII) whitespace in a raw destination —
      // with and without a title, since the title branch exercises a
      // different suffix of the grammar.
      { kind: "link", label: "x", destination: "a b", title: null },
      { kind: "link", label: "x", destination: "a b", title: "t" },
      // §384 fix (F4): an empty-but-PRESENT title, distinct from no title
      // (`title: null`, already covered above) — with both an empty and a
      // non-empty destination.
      { kind: "link", label: "x", destination: "", title: "" },
      { kind: "link", label: "x", destination: "u", title: "" },
    ];

    for (const resource of cases) {
      it(`round-trips ${JSON.stringify(resource)}`, () => {
        const text = serializeRevealResource(resource);
        expect(parseRevealResource(text)).toEqual(
          expect.objectContaining(resource),
        );
      });
    }
  });
});
