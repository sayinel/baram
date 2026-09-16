import { describe, expect, test } from "vitest";

import {
  decodePercent,
  extractNamespace,
  getRelativePath,
  isDescendantPath,
  isImageFile,
  normalizePath,
  resolveNameConflict,
} from "../path-utils";

describe("normalizePath", () => {
  test.each([
    ["/vault/notes/../a.md", "/vault/a.md"],
    ["/vault/notes/./a.md", "/vault/notes/a.md"],
    ["/vault/notes//a.md", "/vault/notes/a.md"],
    ["/vault/a/b/../../c.md", "/vault/c.md"],
    ["/vault/notes/sub/../sub/a.md", "/vault/notes/sub/a.md"],
    // 절대 경로는 루트를 벗어날 수 없다 — POSIX와 같다.
    ["/../a.md", "/a.md"],
    ["/vault/../../a.md", "/a.md"],
    ["/", "/"],
    ["/vault/notes", "/vault/notes"],
    // 상대 경로는 아직 풀 기준이 없으므로 앞쪽 ..를 남긴다.
    ["../a.md", "../a.md"],
    ["../../a.md", "../../a.md"],
    ["a/../b.md", "b.md"],
    ["./a.md", "a.md"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  test("keeps an absolute path absolute and a relative path relative", () => {
    expect(normalizePath("/a/b").startsWith("/")).toBe(true);
    expect(normalizePath("a/b").startsWith("/")).toBe(false);
  });
});

describe("isImageFile", () => {
  test("returns true for image extensions", () => {
    expect(isImageFile("photo.png")).toBe(true);
    expect(isImageFile("photo.jpg")).toBe(true);
    expect(isImageFile("photo.jpeg")).toBe(true);
    expect(isImageFile("photo.gif")).toBe(true);
    expect(isImageFile("photo.webp")).toBe(true);
    expect(isImageFile("photo.svg")).toBe(true);
    expect(isImageFile("photo.ico")).toBe(true);
    expect(isImageFile("photo.bmp")).toBe(true);
    expect(isImageFile("photo.avif")).toBe(true);
  });

  test("case insensitive", () => {
    expect(isImageFile("photo.PNG")).toBe(true);
    expect(isImageFile("photo.Jpg")).toBe(true);
  });

  test("returns false for non-image extensions", () => {
    expect(isImageFile("file.txt")).toBe(false);
    expect(isImageFile("file.md")).toBe(false);
    expect(isImageFile("file.pdf")).toBe(false);
    expect(isImageFile("file")).toBe(false);
  });

  test("handles full paths", () => {
    expect(isImageFile("/Users/foo/bar/photo.png")).toBe(true);
    expect(isImageFile("/Users/foo/bar/file.txt")).toBe(false);
  });
});

describe("getRelativePath", () => {
  test("same directory", () => {
    expect(getRelativePath("/a/b", "/a/b/img.png")).toBe("./img.png");
  });

  test("child directory", () => {
    expect(getRelativePath("/a/b", "/a/b/assets/img.png")).toBe(
      "./assets/img.png",
    );
  });

  test("sibling directory", () => {
    expect(getRelativePath("/a/b", "/a/c/img.png")).toBe("../c/img.png");
  });

  test("parent directory", () => {
    expect(getRelativePath("/a/b/c", "/a/img.png")).toBe("../../img.png");
  });

  test("unrelated paths", () => {
    expect(getRelativePath("/x/y/z", "/a/b/c")).toBe("../../../a/b/c");
  });
});

// --- §61 Namespace: extractNamespace ---

describe("§61 extractNamespace", () => {
  test("extracts directory path from nested file", () => {
    expect(extractNamespace("notes/ai/prompt.md")).toBe("notes/ai");
  });

  test("extracts single directory", () => {
    expect(extractNamespace("notes/readme.md")).toBe("notes");
  });

  test("returns undefined for root-level file", () => {
    expect(extractNamespace("readme.md")).toBeUndefined();
  });

  test("returns undefined for file with no slash", () => {
    expect(extractNamespace("architecture")).toBeUndefined();
  });

  test("handles deeply nested paths", () => {
    expect(extractNamespace("docs/design/part3/section.md")).toBe(
      "docs/design/part3",
    );
  });

  test("returns undefined when slash is at index 0", () => {
    // e.g. "/readme.md" — lastIndexOf('/') === 0, should return undefined
    expect(extractNamespace("/readme.md")).toBeUndefined();
  });
});

describe("resolveNameConflict", () => {
  test("no conflict returns original", () => {
    expect(resolveNameConflict("photo.png", new Set())).toBe("photo.png");
  });

  test("appends -1 on first conflict", () => {
    expect(resolveNameConflict("photo.png", new Set(["photo.png"]))).toBe(
      "photo-1.png",
    );
  });

  test("increments counter on multiple conflicts", () => {
    expect(
      resolveNameConflict(
        "photo.png",
        new Set(["photo-1.png", "photo-2.png", "photo.png"]),
      ),
    ).toBe("photo-3.png");
  });

  test("handles files without extension", () => {
    expect(resolveNameConflict("README", new Set(["README"]))).toBe("README-1");
  });
});

describe("isDescendantPath (issue 595)", () => {
  test("a slash boundary is a descendant on every platform", () => {
    expect(isDescendantPath("/v/foo/bar.md", "/v/foo")).toBe(true);
    expect(isDescendantPath("/v/foo/bar.md", "/v/foo/")).toBe(true);
    expect(isDescendantPath("C:/vault/ns/a.md", "C:/vault/ns")).toBe(true);
  });

  test("a backslash boundary counts only under a directory spelled as a Windows path", () => {
    expect(isDescendantPath("C:\\vault\\ns\\a.md", "C:\\vault\\ns")).toBe(true);
    expect(
      isDescendantPath("\\\\server\\share\\ns\\a.md", "\\\\server\\share\\ns"),
    ).toBe(true);
    // On Unix the backslash is a character of the name: a sibling, not a child.
    expect(isDescendantPath("/v/foo\\bar.md", "/v/foo")).toBe(false);
  });

  test("the directory itself and a sibling sharing the prefix are not descendants", () => {
    expect(isDescendantPath("/v/foo", "/v/foo")).toBe(false);
    expect(isDescendantPath("/v/foo-old/x.md", "/v/foo")).toBe(false);
    expect(isDescendantPath("C:\\vault\\ns-old\\a.md", "C:\\vault\\ns")).toBe(
      false,
    );
    expect(isDescendantPath("/v/foo/x.md", "")).toBe(false);
  });
});

describe("decodePercent", () => {
  test("decodes percent-escapes and leaves a name whose percent is not an escape alone", () => {
    expect(decodePercent("img/a%20b.png")).toBe("img/a b.png");
    expect(decodePercent("%2Fetc%2Fpasswd")).toBe("/etc/passwd");
    // `50% off.md` is a real file name: a malformed escape is kept as written.
    expect(decodePercent("50% off.md")).toBe("50% off.md");
    expect(decodePercent("plain.png")).toBe("plain.png");
  });
});
