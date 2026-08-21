// §294 동영상 라운드트립 — 설계 문서 §294 표의 7행을 그대로 옮긴다.
import { Schema } from "@tiptap/pm/model";
import { describe, expect, test } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "inline*", group: "block", marks: "_" },
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

  test("an iframe is NOT parsed as a video node", () => {
    const input = '<iframe src="https://evil.test/x"></iframe>';
    expect(firstChildType(input)).not.toBe("video");
    expect(roundtrip(input)).toBe(input);
  });

  test("a video tag holding a provider URL is refused", () => {
    // provider URL은 video-file이 아니므로 parseVideoHtml이 거부한다 (§294)
    const input = '<video src="https://youtu.be/abc" width="60%"></video>';
    expect(firstChildType(input)).not.toBe("video");
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
