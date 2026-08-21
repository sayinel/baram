// §293 미디어 소스 분류 — 이 파일이 유일한 열거를 지킨다.
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import {
  classifyMediaSrc,
  embedUrlFor,
  isMediaAtom,
  resolveMediaSrc,
} from "../media-src";

describe("classifyMediaSrc (§293)", () => {
  it("treats raster extensions as images", () => {
    expect(classifyMediaSrc("photo.png")).toBe("image");
    expect(classifyMediaSrc("./a/b/photo.JPG")).toBe("image");
    expect(classifyMediaSrc("https://x.test/p.webp")).toBe("image");
  });

  it("treats the five playable containers as video files", () => {
    for (const ext of ["mp4", "m4v", "mov", "webm", "ogv"]) {
      expect(classifyMediaSrc(`clip.${ext}`)).toBe("video-file");
      expect(classifyMediaSrc(`clip.${ext.toUpperCase()}`)).toBe("video-file");
    }
  });

  it("does NOT accept .mkv — no webview plays it", () => {
    expect(classifyMediaSrc("clip.mkv")).toBe("image");
  });

  it("ignores query strings and fragments when reading the extension", () => {
    expect(classifyMediaSrc("https://cdn.test/a.mp4?token=1")).toBe(
      "video-file",
    );
    expect(classifyMediaSrc("clip.mp4#t=0.1")).toBe("video-file");
  });

  it("classifies provider URLs as embeds", () => {
    expect(classifyMediaSrc("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "video-embed",
    );
    expect(
      classifyMediaSrc("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    ).toBe("video-embed");
    expect(classifyMediaSrc("https://vimeo.com/123456789")).toBe("video-embed");
  });

  it("falls back to image for empty or unknown srcs", () => {
    expect(classifyMediaSrc("")).toBe("image");
    expect(classifyMediaSrc("no-extension")).toBe("image");
    expect(classifyMediaSrc("archive.tar.gz")).toBe("image");
  });
});

describe("embedUrlFor (§293)", () => {
  it("builds the nocookie URL from a youtu.be id", () => {
    expect(embedUrlFor("https://youtu.be/dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
  });

  it("reads the v query param on /watch", () => {
    expect(embedUrlFor("https://www.youtube.com/watch?v=abc123&t=30")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
  });

  it("accepts /shorts/ and /embed/ paths", () => {
    expect(embedUrlFor("https://youtube.com/shorts/abc123")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
    expect(embedUrlFor("https://www.youtube.com/embed/abc123")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
  });

  it("builds the player URL from a vimeo numeric id", () => {
    expect(embedUrlFor("https://vimeo.com/123456789")).toBe(
      "https://player.vimeo.com/video/123456789",
    );
  });

  // 문서가 임베드 URL을 직접 주는 경로를 남기지 않는다는 단정.
  it("rejects ids that fail the character class", () => {
    expect(embedUrlFor("https://youtu.be/../../evil")).toBeNull();
    expect(embedUrlFor("https://youtu.be/id%20with%20space")).toBeNull();
    expect(embedUrlFor("https://vimeo.com/not-a-number")).toBeNull();
    expect(embedUrlFor("https://youtube.com/watch?v=")).toBeNull();
  });

  it("rejects non-provider and non-http srcs", () => {
    expect(embedUrlFor("https://evil.test/watch?v=abc")).toBeNull();
    expect(embedUrlFor("clip.mp4")).toBeNull();
    expect(embedUrlFor("javascript:alert(1)")).toBeNull();
  });
});

describe("resolveMediaSrc (§296)", () => {
  it("passes remote URLs and data URIs through untouched", () => {
    expect(resolveMediaSrc("https://x.test/a.mp4", "/vault")).toBe(
      "https://x.test/a.mp4",
    );
    expect(resolveMediaSrc("data:video/mp4;base64,AAA", "/vault")).toBe(
      "data:video/mp4;base64,AAA",
    );
  });

  it("resolves a relative path against the base directory", () => {
    expect(resolveMediaSrc("assets/clip.mp4", "/vault/notes")).toBe(
      "asset://localhost//vault/notes/assets/clip.mp4",
    );
  });

  it("leaves absolute paths alone and tolerates a missing base directory", () => {
    expect(resolveMediaSrc("/abs/clip.mp4", "/vault")).toBe(
      "asset://localhost//abs/clip.mp4",
    );
    expect(resolveMediaSrc("clip.mp4", null)).toBe(
      "asset://localhost/clip.mp4",
    );
  });
});

describe("isMediaAtom (§295)", () => {
  it("covers exactly the two `![](…)`-shaped atoms", () => {
    expect(isMediaAtom("image")).toBe(true);
    expect(isMediaAtom("video")).toBe(true);
    expect(isMediaAtom("wikilink")).toBe(false);
    expect(isMediaAtom("paragraph")).toBe(false);
  });
});
