import { describe, expect, it } from "vitest";

import {
  getLanguageForFile,
  isHtmlFile,
  isMarkdownFile,
  isPdfFile,
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

describe("getLanguageForFile", () => {
  it("maps html extensions to the html language", () => {
    expect(getLanguageForFile("/vault/page.html")).toBe("html");
    expect(getLanguageForFile("/vault/page.htm")).toBe("html");
  });

  it("returns null for unknown extensions", () => {
    expect(getLanguageForFile("/vault/data.unknown")).toBe(null);
  });
});
