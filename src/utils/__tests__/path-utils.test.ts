import { describe, test, expect } from "vitest";
import { isImageFile, getRelativePath, resolveNameConflict, extractNamespace } from "../path-utils";

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
    expect(getRelativePath("/a/b", "/a/b/assets/img.png")).toBe("./assets/img.png");
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
    expect(extractNamespace("docs/design/part3/section.md")).toBe("docs/design/part3");
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
    expect(resolveNameConflict("photo.png", new Set(["photo.png"]))).toBe("photo-1.png");
  });

  test("increments counter on multiple conflicts", () => {
    expect(
      resolveNameConflict("photo.png", new Set(["photo.png", "photo-1.png", "photo-2.png"])),
    ).toBe("photo-3.png");
  });

  test("handles files without extension", () => {
    expect(resolveNameConflict("README", new Set(["README"]))).toBe("README-1");
  });
});
