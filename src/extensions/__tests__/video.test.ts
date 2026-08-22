// §294 동영상 라운드트립 — 설계 문서 §294 표의 7행을 그대로 옮긴다.
import { Schema } from "@tiptap/pm/model";
import { describe, expect, test } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
    // §294 fix round 1 (I1): a single-block document can't observe a missing
    // separator — C1 only shows up with a heading or a second block beside it.
    heading: {
      content: "inline*",
      group: "block",
      marks: "_",
      attrs: { level: { default: 1 } },
    },
    image: {
      group: "block",
      atom: true,
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
        widthPercent: { default: 100 },
      },
    },
    video: {
      group: "block",
      atom: true,
      attrs: {
        src: { default: null },
        alt: { default: null },
        title: { default: null },
        widthPercent: { default: 100 },
        // §294 fix round 1 (M3): the real node declares this (video.ts) — the
        // fixture must match the shipped schema or the pixel-width branch of
        // parseVideoHtml is exercised by nothing.
        widthPixel: { default: undefined },
      },
    },
    htmlBlock: {
      group: "block",
      atom: true,
      attrs: { content: { default: "" } },
    },
    text: { group: "inline" },
  },
  marks: {},
});

function firstChildType(md: string): string {
  return markdownToProsemirror(md, schema).firstChild!.type.name;
}

function roundtrip(md: string): string {
  return prosemirrorToMarkdown(markdownToProsemirror(md, schema)).trimEnd();
}

describe("video roundtrip (§294)", () => {
  test("local file with caption", () => {
    const input = "![캡션](clip.mp4)";
    expect(firstChildType(input)).toBe("video");
    expect(roundtrip(input)).toBe(input);
  });

  test("remote video file URL", () => {
    const input = "![](https://cdn.example.com/a.mp4)";
    expect(firstChildType(input)).toBe("video");
    expect(roundtrip(input)).toBe(input);
  });

  test("provider embed URL", () => {
    const input = "![](https://youtu.be/dQw4w9WgXcQ)";
    expect(firstChildType(input)).toBe("video");
    expect(roundtrip(input)).toBe(input);
  });

  test("resized video persists as a video HTML tag", () => {
    const input = '<video src="clip.mp4" width="60%"></video>';
    expect(firstChildType(input)).toBe("video");
    expect(roundtrip(input)).toBe(input);
  });

  test("width=100% normalizes back to standard markdown", () => {
    const input = '<video src="clip.mp4" width="100%"></video>';
    expect(roundtrip(input)).toBe("![](clip.mp4)");
  });

  test("pixel width round-trips as a video HTML tag", () => {
    // §294 fix round 1 (M3): px > 100 takes the widthPixel branch, not widthPercent.
    const input = '<video src="clip.mp4" width="640"></video>';
    expect(firstChildType(input)).toBe("video");
    expect(roundtrip(input)).toBe(input);
  });

  // §294 fix round 2 (I5): the ONE success shape that reaches md-to-pm.ts's
  // block-html branch (~191-200) directly, rather than through
  // isVideoHtmlPair's open/close-pair reassembly. A self-closing tag alone on
  // a line satisfies CommonMark's HTML-block type 7 ("a complete tag ...
  // followed only by whitespace to end of line"), so remark hands md-to-pm a
  // single block `html` mdast node — unlike `<video ...></video>` on one
  // line, which does NOT match type 7 (content follows the open tag on the
  // same line) and falls to inline HTML split into a pair instead. Every
  // other fixture reaching the block-html branch (above, and the two
  // multi-line cases below) is a REFUSAL landing on htmlBlock; without this
  // case, deleting the block-html branch entirely would leave the suite
  // green while a self-closing `<video .../>` silently degraded to htmlBlock.
  test("self-closing tag alone on a line takes the block-html path directly", () => {
    const input = '<video src="clip.mp4" width="60%"/>';
    expect(firstChildType(input)).toBe("video");
    expect(roundtrip(input)).toBe('<video src="clip.mp4" width="60%"></video>');
  });

  test("an iframe is NOT parsed as a video node", () => {
    const input = '<iframe src="https://evil.test/x"></iframe>';
    expect(firstChildType(input)).not.toBe("video");
    expect(roundtrip(input)).toBe(input);
  });

  test("a video tag holding a provider URL is refused, and preserved verbatim", () => {
    // provider URL은 video-file이 아니므로 parseVideoHtml이 거부한다 (§294)
    // §294 fix round 1 (I3): a refusal must not erase the user's markup — it
    // falls back to htmlBlock, not to a silently-emptied paragraph.
    const input = '<video src="https://youtu.be/abc" width="60%"></video>';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("inline occurrence stays out of the video path", () => {
    const input = "text ![](clip.mp4) text";
    expect(firstChildType(input)).toBe("paragraph");
    expect(roundtrip(input)).toBe(input);
  });

  test("images are untouched", () => {
    const input = "![alt](photo.png)";
    expect(firstChildType(input)).toBe("image");
    expect(roundtrip(input)).toBe(input);
  });

  test("caption and title survive the trip", () => {
    const input = '![캡션](clip.mp4 "제목")';
    expect(roundtrip(input)).toBe(input);
  });

  test("PM video with widthPercent serializes to a video HTML tag", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.video.create({ src: "clip.mp4", widthPercent: 50 }),
    ]);
    expect(prosemirrorToMarkdown(doc).trimEnd()).toBe(
      '<video src="clip.mp4" width="50%"></video>',
    );
  });

  test("special chars in src/alt are escaped in the video HTML tag", () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.video.create({
        src: "a/b/clip.mp4",
        alt: "a & b",
        widthPercent: 75,
      }),
    ]);
    const md = prosemirrorToMarkdown(doc).trimEnd();
    expect(md).toBe(
      '<video src="a/b/clip.mp4" alt="a &amp; b" width="75%"></video>',
    );
    expect(markdownToProsemirror(md, schema).firstChild!.attrs.alt).toBe(
      "a & b",
    );
    expect(roundtrip(md)).toBe(md);
  });
});

// §294 fix round 1 (C1, critical): a widthPercent===100 video serializes as a
// bare phrasing-level mdast `image` node. Before this fix, pm-to-md.ts only
// wrapped `typeName === "image"` in a paragraph — video fell through to the
// generic lookup, and the unwrapped node got glued to its neighbors by
// remark-stringify with no blank-line separator. A single-block fixture can
// never observe this — every case here needs a second block.
describe("multi-block round trip preserves block separators (§294 C1)", () => {
  test("text, video, text", () => {
    const input = "a\n\n![](clip.mp4)\n\nb";
    expect(roundtrip(input)).toBe(input);
  });

  test("video followed by a heading", () => {
    const input = "![](clip.mp4)\n\n# H";
    expect(roundtrip(input)).toBe(input);
  });

  test("two videos back to back", () => {
    const input = "![](a.mp4)\n\n![](b.mp4)";
    expect(roundtrip(input)).toBe(input);
  });

  test("control: text, image, text (already worked before this fix)", () => {
    const input = "a\n\n![](photo.png)\n\nb";
    expect(roundtrip(input)).toBe(input);
  });
});

// §294 fix round 1 (I2): isVideoHtmlPair's only defense is `children.length
// === 2` plus the two exact tag-shape checks. These pin that a future
// "make it more permissive" edit can't start swallowing content without a
// test going red — firstChildType must never become "video" for any of these
// malformed shapes.
//
// ‼️ Only the last case gets a full round-trip-identity assertion. The other
// four hit a pre-existing, unrelated pipeline limitation that predates this
// task entirely: convertInlineNode has no passthrough for an unrecognized
// inline "html" mdast node (true for `<span>`, `<b>`, any tag that isn't
// `<u>/<mark>/<sub>/<sup>` today) — it is dropped regardless of whether video
// code is even in the picture. isVideoHtmlPair correctly refuses to touch
// these shapes (proven by firstChildType below); the dropped content is a
// property of the general pipeline, not of this function, so this test pins
// the actual (imperfect but stable, non-video-caused) current output rather
// than asserting a round-trip identity that was never true before video
// existed either.
describe("isVideoHtmlPair refuses malformed shapes (§294 I2)", () => {
  test("text on both sides of the pair", () => {
    const input = 'a <video src="x.mp4"></video> b';
    expect(firstChildType(input)).not.toBe("video");
    expect(roundtrip(input)).toBe("a  b");
  });

  test("fallback content between the tags", () => {
    const input = '<video src="x.mp4">fallback</video>';
    expect(firstChildType(input)).not.toBe("video");
    expect(roundtrip(input)).toBe("fallback");
  });

  test("two videos in one paragraph (no blank line between them)", () => {
    const input = '<video src="a.mp4"></video><video src="b.mp4"></video>';
    expect(firstChildType(input)).not.toBe("video");
    expect(roundtrip(input)).toBe("");
  });

  test("an unrelated inline html pair", () => {
    const input = "<span>a</span>";
    expect(firstChildType(input)).not.toBe("video");
    expect(roundtrip(input)).toBe("a");
  });

  test("a lone closing tag is its own (non-paired) html block", () => {
    // This one is NOT a paragraph at all — `</video>` alone on a line is a
    // single CommonMark type-7 html block, so it never reaches
    // isVideoHtmlPair (which only looks inside paragraphs). It survives via
    // the ordinary htmlBlock fallback, byte-exact.
    const input = "</video>";
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });
});

// §294 fix round 1 (I4): parseVideoHtml refuses any <video> tag carrying an
// attribute outside {src, alt, title, width} — refusal keeps it as htmlBlock
// (verbatim) rather than silently discarding the attribute while normalizing
// the rest to `![](…)`.
describe("attribute allowlist refuses unrecognized attributes (§294 I4)", () => {
  test("self-closing tag with controls/poster is refused, byte-exact", () => {
    const input = '<video src="clip.mp4" controls poster="p.jpg" />';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("open/close pair with controls/poster is refused, byte-exact", () => {
    const input = '<video src="clip.mp4" controls poster="p.jpg"></video>';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("multi-line tag with controls/poster is refused, byte-exact", () => {
    const input = '<video src="clip.mp4" controls poster="p.jpg">\n</video>';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("a multi-line tag with no extra attributes normalizes like width=100%", () => {
    // No attribute here falls outside {src, alt, title, width}, so this is
    // NOT refused by the allowlist above — it behaves like the width=100%
    // case: a video-file src with nothing else normalizes to plain
    // markdown. That loses the fact it was written across two lines, but
    // that is a formatting detail, not a discarded attribute — the same
    // category of intended §294 normalization as width=100%, flagged to
    // the reviewer as the one reading of I4 its two paired examples left
    // ambiguous (one of the two, this one, carries no attribute to discard).
    const input = '<video src="clip.mp4">\n</video>';
    expect(firstChildType(input)).toBe("video");
    expect(roundtrip(input)).toBe("![](clip.mp4)");
  });
});
