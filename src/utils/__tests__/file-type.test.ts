import { describe, expect, it } from "vitest";

import {
  getLanguageForFile,
  isBinaryViewerFile,
  isHtmlFile,
  isImageFile,
  isMarkdownFile,
  isPdfFile,
  isRenderedPreviewFile,
  isSvgFile,
} from "../file-type";

describe("isMarkdownFile", () => {
  it("returns true for markdown extensions", () => {
    expect(isMarkdownFile("/vault/note.md")).toBe(true);
    expect(isMarkdownFile("/vault/note.markdown")).toBe(true);
    expect(isMarkdownFile("/vault/note.mdx")).toBe(true);
    expect(isMarkdownFile("/vault/NOTE.MD")).toBe(true);
  });

  it("treats untitled files (no path) as markdown", () => {
    expect(isMarkdownFile(undefined)).toBe(true);
    expect(isMarkdownFile("")).toBe(true);
  });

  it("returns false for non-markdown files", () => {
    expect(isMarkdownFile("/vault/page.html")).toBe(false);
    expect(isMarkdownFile("/vault/script.ts")).toBe(false);
  });
});

describe("isHtmlFile", () => {
  it("returns true for .html and .htm", () => {
    expect(isHtmlFile("/vault/page.html")).toBe(true);
    expect(isHtmlFile("/vault/page.htm")).toBe(true);
    expect(isHtmlFile("/vault/PAGE.HTML")).toBe(true);
  });

  it("returns false for other files and untitled", () => {
    expect(isHtmlFile("/vault/note.md")).toBe(false);
    expect(isHtmlFile("/vault/style.css")).toBe(false);
    expect(isHtmlFile("/vault/README")).toBe(false);
    expect(isHtmlFile(undefined)).toBe(false);
    expect(isHtmlFile("")).toBe(false);
  });
});

describe("isPdfFile", () => {
  it("returns true for .pdf", () => {
    expect(isPdfFile("/vault/doc.pdf")).toBe(true);
    expect(isPdfFile("/vault/DOC.PDF")).toBe(true);
  });

  it("returns false for other files and untitled", () => {
    expect(isPdfFile("/vault/note.md")).toBe(false);
    expect(isPdfFile("/vault/page.html")).toBe(false);
    expect(isPdfFile("/vault/pdf")).toBe(false);
    expect(isPdfFile(undefined)).toBe(false);
    expect(isPdfFile("")).toBe(false);
  });
});

describe("isImageFile / isBinaryViewerFile", () => {
  it("returns true for raster image extensions", () => {
    expect(isImageFile("/vault/photo.png")).toBe(true);
    expect(isImageFile("/vault/photo.jpg")).toBe(true);
    expect(isImageFile("/vault/photo.JPEG")).toBe(true);
    expect(isImageFile("/vault/photo.bmp")).toBe(true);
    expect(isImageFile("/vault/photo.webp")).toBe(true);
    expect(isImageFile("/vault/photo.gif")).toBe(true);
  });

  it("returns false for svg (text, editable) and other files", () => {
    expect(isImageFile("/vault/logo.svg")).toBe(false);
    expect(isImageFile("/vault/note.md")).toBe(false);
    expect(isImageFile(undefined)).toBe(false);
  });

  it("isBinaryViewerFile covers images and pdf, not text formats", () => {
    expect(isBinaryViewerFile("/vault/photo.png")).toBe(true);
    expect(isBinaryViewerFile("/vault/doc.pdf")).toBe(true);
    expect(isBinaryViewerFile("/vault/logo.svg")).toBe(false);
    expect(isBinaryViewerFile("/vault/page.html")).toBe(false);
    expect(isBinaryViewerFile("/vault/note.md")).toBe(false);
  });
});

describe("isRenderedPreviewFile", () => {
  it("returns true for html and svg", () => {
    expect(isRenderedPreviewFile("/vault/page.html")).toBe(true);
    expect(isRenderedPreviewFile("/vault/page.htm")).toBe(true);
    expect(isRenderedPreviewFile("/vault/logo.svg")).toBe(true);
  });

  it("returns false for binaries and markdown", () => {
    expect(isRenderedPreviewFile("/vault/photo.png")).toBe(false);
    expect(isRenderedPreviewFile("/vault/doc.pdf")).toBe(false);
    expect(isRenderedPreviewFile("/vault/note.md")).toBe(false);
    expect(isRenderedPreviewFile(undefined)).toBe(false);
  });

  it("isSvgFile matches only .svg", () => {
    expect(isSvgFile("/vault/logo.svg")).toBe(true);
    expect(isSvgFile("/vault/LOGO.SVG")).toBe(true);
    expect(isSvgFile("/vault/page.html")).toBe(false);
    expect(isSvgFile("/vault/photo.png")).toBe(false);
    expect(isSvgFile(undefined)).toBe(false);
  });
});

describe("getLanguageForFile", () => {
  it("maps html extensions to the html language", () => {
    expect(getLanguageForFile("/vault/page.html")).toBe("html");
    expect(getLanguageForFile("/vault/page.htm")).toBe("html");
  });

  it("returns null for unknown extensions", () => {
    expect(getLanguageForFile("/vault/data.unknown")).toBe(null);
  });
});
