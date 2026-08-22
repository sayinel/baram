// §300-2 분류기 합의.
//
// 열거 목록은 media-src.ts 한 곳인데 소비자가 둘(md-to-pm과 NodeView)이다. 확장자를
// 목록에 더했을 때 한쪽만 반영되는 사고를 막으려고, "분류기가 뭐라고 하는가"와
// "파이프라인이 실제로 어떤 노드를 만드는가"를 같은 픽스처에 대해 맞춰 본다.
import { Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { classifyMediaSrc } from "../../utils/media-src";
import { markdownToProsemirror } from "../md-to-pm";

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
    text: { group: "inline" },
  },
  marks: {},
});

const FIXTURES = [
  "photo.png",
  "photo.JPEG",
  "art.webp",
  "art.avif",
  "clip.mp4",
  "clip.M4V",
  "clip.mov",
  "clip.webm",
  "clip.ogv",
  "clip.mkv",
  "https://cdn.test/a.mp4?token=1",
  "https://youtu.be/dQw4w9WgXcQ",
  "https://www.youtube.com/watch?v=abc123",
  "https://youtube.com/shorts/abc123",
  "https://vimeo.com/123456789",
  "https://evil.test/watch?v=abc",
  "no-extension",
];

describe("classifier agreement (§300-2)", () => {
  it.each(FIXTURES)("md-to-pm agrees with classifyMediaSrc for %s", (src) => {
    const expected = classifyMediaSrc(src) === "image" ? "image" : "video";
    const doc = markdownToProsemirror(`![](${src})\n`, schema);
    expect(doc.firstChild!.type.name).toBe(expected);
  });
});
