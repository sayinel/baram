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
// ‼️ §294 fix round 3 (I6) CHANGED WHAT THREE OF THESE ASSERT. They used to
// pin the lossy output ('a  b', 'fallback', '') on the grounds that the loss
// belonged to a pre-existing, video-independent pipeline limitation:
// convertInlineNode has no passthrough for an unrecognized inline "html"
// mdast node (still true for `<span>`, `<b>`, any tag outside
// `<u>/<mark>/<sub>/<sup>` — see the last case here, which still loses its
// tags and still pins that honestly).
//
// What changed is the exposure, not the mechanism. The app itself now writes
// `<video src="…" width="60%"></video>` into the file every time a video is
// resized, so the loss stopped being "a user's hand-written raw HTML" and
// became "content this editor generated": type one word on that line, or
// delete the blank line between two resized videos, and the next save drops
// the video entirely. md-to-pm.ts now applies the same refuse-and-preserve
// policy parseVideoHtml already used — a paragraph carrying a
// `<video …>`/`</video>` pair plus other inline content is kept whole as an
// htmlBlock — so these three are byte-exact round trips now. firstChildType
// is still asserted NOT to be "video": the paragraph is preserved verbatim,
// never reinterpreted as a video node.
describe("isVideoHtmlPair refuses malformed shapes (§294 I2/I6)", () => {
  test("text on both sides of the pair", () => {
    const input = 'a <video src="x.mp4"></video> b';
    expect(firstChildType(input)).not.toBe("video");
    expect(roundtrip(input)).toBe(input);
  });

  test("fallback content between the tags", () => {
    const input = '<video src="x.mp4">fallback</video>';
    expect(firstChildType(input)).not.toBe("video");
    expect(roundtrip(input)).toBe(input);
  });

  test("two videos in one paragraph (no blank line between them)", () => {
    const input = '<video src="a.mp4"></video><video src="b.mp4"></video>';
    expect(firstChildType(input)).not.toBe("video");
    expect(roundtrip(input)).toBe(input);
  });

  // The preservation above is deliberately scoped to paragraphs that actually
  // carry a video pair — an unrelated inline tag still hits the general
  // limitation named at the top of this block, unchanged by §294.
  test("an unrelated inline html pair", () => {
    const input = "<span>a</span>";
    expect(firstChildType(input)).not.toBe("video");
    expect(roundtrip(input)).toBe("a");
  });

  // ‼️ The reconstruction is refused, not attempted, when the paragraph
  // cannot be rebuilt byte-for-byte: mdast does not carry the source string
  // this far, so a mark (`**bold**`) or a decoded escape/character reference
  // in a text child would let us write back something subtly different from
  // what the user typed. Refusing leaves the pre-existing lossy path in
  // place, which is honest, rather than inventing bytes.
  test("a non-text/html inline sibling refuses reconstruction", () => {
    // `inlineCode` is a phrasing node whose source form (the backticks) is
    // not recoverable from the mdast value, so the paragraph is left on the
    // pre-existing path instead of being rebuilt wrongly.
    const input = '`code` <video src="x.mp4"></video>';
    expect(firstChildType(input)).toBe("paragraph");
    expect(roundtrip(input)).not.toContain("<video");
  });

  test("an ampersand in the surrounding text refuses reconstruction", () => {
    // remark hands us the DECODED text ("a & b"), so re-emitting it could
    // differ from the source bytes (`a &amp; b`). Refuse instead of guessing.
    const input = 'a &amp; b <video src="x.mp4"></video>';
    expect(firstChildType(input)).not.toBe("htmlBlock");
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

// §294 fix round 3 (C1, critical): parseVideoHtml returned a non-null result
// whenever the attribute NAME set was allowed, no matter whether the `width`
// VALUE parsed. A rejected value fell through with widthPercent still 100, so
// pmToMdast serialized plain `![](src)` and the attribute the user typed was
// GONE from their file. The whitelist guarded names and left values unguarded.
//
// The policy is now one shared function (media-html-tag.ts parseWidthValue),
// used by `<img>` too:
//   - a bare number is PIXELS — HTML's own `<video width>` semantics. The old
//     code reinterpreted a bare number <= 100 as a percentage and rewrote
//     `width="80"` into `width="80%"` in the user's file.
//   - `N%` is percent, 1..100.
//   - everything else is REFUSED, never clamped or truncated: turning `150%`
//     into `100%` or `80.5%` into `80%` is still silently editing the file.
//     A refusal lands the tag on htmlBlock, byte-exact.
describe("width values that cannot be represented are refused, not deleted (§294 C1)", () => {
  test("a percentage above 100 is preserved verbatim, not clamped", () => {
    const input = '<video src="clip.mp4" width="150%"></video>';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("zero is preserved verbatim", () => {
    const input = '<video src="clip.mp4" width="0"></video>';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("a non-numeric width is preserved verbatim", () => {
    const input = '<video src="clip.mp4" width="abc"></video>';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("a fractional percentage is preserved verbatim, not truncated", () => {
    const input = '<video src="clip.mp4" width="80.5%"></video>';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("a bare number is PIXELS and survives unchanged", () => {
    const input = '<video src="clip.mp4" width="640"></video>';
    const node = markdownToProsemirror(input, schema).firstChild!;
    expect(node.type.name).toBe("video");
    expect(node.attrs.widthPixel).toBe(640);
    expect(node.attrs.widthPercent).toBe(100);
    expect(roundtrip(input)).toBe(input);
  });

  test("a bare number <= 100 is pixels too — NOT reinterpreted as a percentage", () => {
    // The old heuristic turned this into widthPercent 80 and wrote
    // `width="80%"` back to the file. 80 pixels is what the markup says.
    const input = '<video src="clip.mp4" width="80"></video>';
    const node = markdownToProsemirror(input, schema).firstChild!;
    expect(node.attrs.widthPixel).toBe(80);
    expect(roundtrip(input)).toBe(input);
  });

  test("an empty width value is preserved verbatim, not read as 100%", () => {
    const input = '<video src="clip.mp4" width=""></video>';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("a spelling we could not write back identically is refused", () => {
    // `080` parses to 80, but building the tag again emits `width="80"` — a
    // different byte sequence in the user's file. parseWidthValue's
    // String(n) === digits self-check is exactly that round-trip guarantee.
    const input = '<video src="clip.mp4" width="080"></video>';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("an integer too large to print back identically is refused", () => {
    const input = '<video src="clip.mp4" width="99999999999999999999"></video>';
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });
});

// §294 fix round 3 (I5): hasOnlyAllowedAttrs moved into the shared parser, so
// its deliberate conservatism needs tests on this side too. Nothing outside
// `name="…"` is accepted, and a future "let's also allow single quotes" edit
// must not slip in silently.
//
// ‼️ TWO different mechanisms produce these refusals, and mutation testing
// caught me attributing all of them to the allowlist. When the mis-quoted
// attribute is `src` ITSELF, the refusal comes from getAttr: it only reads
// `src="…"`, finds nothing, and a video with no src is refused whatever the
// allowlist says (deleting the allowlist check leaves those two cases green).
// Only the third case isolates the allowlist — `src` parses fine there, so
// without the name check the tag WOULD become a video node and `title` would
// be silently dropped on save.
describe('quoting shapes outside `name="…"` are refused (§294 I5)', () => {
  test("a single-quoted src is preserved verbatim (no readable src)", () => {
    const input = "<video src='clip.mp4'></video>";
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("an unquoted src is preserved verbatim (no readable src)", () => {
    const input = "<video src=clip.mp4></video>";
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });

  test("a single-quoted SECONDARY attribute is refused by the name allowlist", () => {
    const input = "<video src=\"clip.mp4\" title='x'></video>";
    expect(firstChildType(input)).toBe("htmlBlock");
    expect(roundtrip(input)).toBe(input);
  });
});

// §294 fix round 3 (I1), the other half: the resize commit clears widthPixel
// by passing `widthPixel: undefined` (video-view.tsx). That only discards the
// stale pixel width if ProseMirror really resets the attr to its default when
// handed undefined — and only helps the user if the resulting markdown carries
// the DRAG's percentage instead of the pixel width buildVideoHtml prefers.
// Both steps are asserted here, at the level where they are observable.
describe("a cleared widthPixel lets the drag reach the file (§294 I1)", () => {
  test("undefined resets the attr and the percentage is what gets written", () => {
    const sized = schema.nodes.video.create({
      src: "clip.mp4",
      widthPixel: 640,
    });
    expect(sized.attrs.widthPixel).toBe(640);

    // Exactly what updateAttributes({widthPercent, widthPixel: undefined}) does.
    const resized = sized.type.create({
      ...sized.attrs,
      widthPercent: 20,
      widthPixel: undefined,
    });
    expect(resized.attrs.widthPixel).toBeUndefined();

    const doc = schema.nodes.doc.create(null, [resized]);
    expect(prosemirrorToMarkdown(doc).trimEnd()).toBe(
      '<video src="clip.mp4" width="20%"></video>',
    );
  });

  test("control: without the clear, the pixel width still wins on save", () => {
    // The defect this pins: buildVideoHtml prefers widthPixel, so a resize
    // that only set widthPercent was silently thrown away.
    const stale = schema.nodes.video.create({
      src: "clip.mp4",
      widthPercent: 20,
      widthPixel: 640,
    });
    const doc = schema.nodes.doc.create(null, [stale]);
    expect(prosemirrorToMarkdown(doc).trimEnd()).toBe(
      '<video src="clip.mp4" width="640"></video>',
    );
  });
});
