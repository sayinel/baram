// §293 미디어 소스 분류 — 이 파일이 유일한 열거를 지킨다.
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

import {
  classifyMediaSrc,
  embedUrlFor,
  isMediaAtom,
  isMediaFilePath,
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
    expect(embedUrlFor("https://youtu.be/id%20with%20space")).toBeNull();
    expect(embedUrlFor("https://vimeo.com/not-a-number")).toBeNull();
    expect(embedUrlFor("https://youtube.com/watch?v=")).toBeNull();
  });

  it("rejects non-provider and non-http srcs", () => {
    expect(embedUrlFor("https://evil.test/watch?v=abc")).toBeNull();
    expect(embedUrlFor("clip.mp4")).toBeNull();
    expect(embedUrlFor("javascript:alert(1)")).toBeNull();
  });

  // §298 불변식: 어떤 입력을 넣어도 결과는 null이거나, 우리가 구성한 두 prefix 중 하나에
  // 문자 클래스를 통과한 id가 붙은 형태뿐이다 — dot-segment든 percent-encoding이든 쿼리
  // 문자열 안의 트래버설이든, 그 무엇도 두 provider 호스트를 벗어난 URL을 만들 수 없다.
  it("never produces a URL off our two constructed prefixes, whatever the input", () => {
    const adversarial = [
      "https://youtu.be/../../evil",
      "https://youtu.be/%2e%2e/%2e%2e/evil",
      "https://youtu.be/abc/../../../etc/passwd",
      "https://youtube.com/watch?v=../../x",
      "https://vimeo.com/../../9",
      "https://youtu.be/a?next=https://evil.test",
    ];
    const shapeRe =
      /^(https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{1,64}|https:\/\/player\.vimeo\.com\/video\/[0-9]{1,20})$/;

    for (const src of adversarial) {
      const result = embedUrlFor(src);
      expect(result === null || shapeRe.test(result)).toBe(true);
    }
  });

  // §293 finding 2 회귀 가드: 쿼리 문자열 안에 "/../"가 있어도 v 파라미터 자체가
  // 깨끗하면 정상 provider URL로 취급해야 한다 — 원시 src 전체를 보는 검사는 이 케이스를
  // 잘못 거부한다.
  it("accepts a clean v param even when the query string carries a dot-segment-shaped value elsewhere", () => {
    expect(
      embedUrlFor("https://www.youtube.com/watch?v=abc123&ref=/../y"),
    ).toBe("https://www.youtube-nocookie.com/embed/abc123");
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

// §297 fix (R1): a different question from classifyMediaSrc's — "is this file
// media at all", not "which node should `![](this)` become". The two must
// disagree on an unrecognized extension: classifyMediaSrc's "image" fallback
// is correct for the markdown-fallback contract md-to-pm.ts depends on, and
// wrong as an "is this a real media file" test — use-external-drop.ts's OS
// drop filter needed the second answer, not the first.
describe("isMediaFilePath (§297 R1)", () => {
  it("accepts recognized image extensions", () => {
    expect(isMediaFilePath("photo.png")).toBe(true);
    expect(isMediaFilePath("./a/b/photo.JPG")).toBe(true);
  });

  it("accepts recognized video extensions", () => {
    expect(isMediaFilePath("clip.mp4")).toBe(true);
    expect(isMediaFilePath("clip.MOV")).toBe(true);
  });

  it("rejects an unrecognized document extension, unlike classifyMediaSrc's fallback", () => {
    expect(classifyMediaSrc("report.pdf")).toBe("image"); // the fallback this guards against
    expect(isMediaFilePath("report.pdf")).toBe(false);
    expect(isMediaFilePath("archive.zip")).toBe(false);
    expect(isMediaFilePath("notes.docx")).toBe(false);
  });

  it("rejects .mkv, matching classifyMediaSrc's video-file refusal", () => {
    expect(isMediaFilePath("clip.mkv")).toBe(false);
  });

  it("rejects an extensionless or empty path", () => {
    expect(isMediaFilePath("no-extension")).toBe(false);
    expect(isMediaFilePath("")).toBe(false);
  });
});
