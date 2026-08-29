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
      expect(parseRevealResource("[x](<a b>)")).toEqual({
        kind: "link",
        label: "x",
        destination: "a b",
        title: null,
      });
    });

    it("parses an angle-bracket image destination with whitespace", () => {
      expect(parseRevealResource("![x](<a b>)")).toEqual({
        kind: "image",
        label: "x",
        destination: "a b",
        title: null,
      });
    });

    it("parses a whitespace-containing video filename", () => {
      expect(parseRevealResource("![x](<clip one.mp4>)")).toEqual({
        kind: "image",
        label: "x",
        destination: "clip one.mp4",
        title: null,
      });
    });

    it("parses an empty destination with no title", () => {
      expect(parseRevealResource("[x]()")).toEqual({
        kind: "link",
        label: "x",
        destination: "",
        title: null,
      });
    });

    it("parses an empty destination with a title", () => {
      expect(parseRevealResource('[x](<> "t")')).toEqual({
        kind: "link",
        label: "x",
        destination: "",
        title: "t",
      });
    });

    it("unescapes an escaped ] in the label back to a literal ]", () => {
      expect(parseRevealResource("[a\\]b](u)")).toEqual({
        kind: "link",
        label: "a]b",
        destination: "u",
        title: null,
      });
    });

    it("unescapes an escaped ] in the alt back to a literal ] (media)", () => {
      expect(parseRevealResource("![a\\]b](x.png)")).toEqual({
        kind: "image",
        label: "a]b",
        destination: "x.png",
        title: null,
      });
    });

    it("unescapes an escaped title quote", () => {
      expect(parseRevealResource('[x](u "say \\"hi\\"")')).toEqual({
        kind: "link",
        label: "x",
        destination: "u",
        title: 'say "hi"',
      });
    });

    it("unescapes < inside an angle-bracket link destination", () => {
      expect(parseRevealResource("[x](<a \\< b>)")).toEqual({
        kind: "link",
        label: "x",
        destination: "a < b",
        title: null,
      });
    });

    it("unescapes < inside an angle-bracket media destination", () => {
      expect(parseRevealResource("![x](<a \\< b>)")).toEqual({
        kind: "image",
        label: "x",
        destination: "a < b",
        title: null,
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
    ];

    for (const resource of cases) {
      it(`round-trips ${JSON.stringify(resource)}`, () => {
        const text = serializeRevealResource(resource);
        expect(parseRevealResource(text)).toEqual(resource);
      });
    }
  });
});
