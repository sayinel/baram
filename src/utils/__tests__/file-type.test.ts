import { describe, expect, it } from "vitest";

import {
  getLanguageForFile,
  isBinaryViewerFile,
  isHtmlFile,
  isImageFile,
  isMarkdownEmbeddableAsset,
  isMarkdownFile,
  isPdfFile,
  isSvgFile,
  isTextFile,
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

  it("returns false for svg (text, plugin-previewed) and other files", () => {
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

describe("getLanguageForFile", () => {
  it("maps html extensions to the html language", () => {
    expect(getLanguageForFile("/vault/page.html")).toBe("html");
    expect(getLanguageForFile("/vault/page.htm")).toBe("html");
  });

  it("returns null for unknown extensions", () => {
    expect(getLanguageForFile("/vault/data.unknown")).toBe(null);
  });
});

describe("isTextFile", () => {
  it("accepts files with a known code language", () => {
    for (const p of ["a.ts", "a.py", "a.json", "a.toml", "a.css", "a.sh"]) {
      expect(isTextFile(p), p).toBe(true);
    }
  });

  it("accepts plain-text types that have no language", () => {
    for (const p of ["notes.txt", "data.csv", "run.log", "a.tsv"]) {
      expect(isTextFile(p), p).toBe(true);
    }
  });

  /**
   * ‼️ 이 단정이 이 함수의 존재 이유다. 탭 표면은 모르는 확장자를 `return "code"`로
   * 떨어뜨려 CodeMirror에 UTF-8로 싣고, 자동 저장은 `isBinaryViewerFile`만
   * 건너뛴다 — dirty가 되면 원본을 덮어쓴다. "열린다"를 "읽을 수 있다"로 읽으면
   * 그 경로가 열린다.
   */
  it("rejects binaries the tab surface would still open as code", () => {
    for (const p of ["a.zip", "a.mp4", "a.woff2", "a.exe"]) {
      expect(isTextFile(p), p).toBe(false);
    }
  });

  it("rejects an empty path and an extensionless name", () => {
    expect(isTextFile("")).toBe(false);
    expect(isTextFile(undefined)).toBe(false);
    expect(isTextFile("/vault/Makefile")).toBe(false);
  });
});

describe("isSvgFile / isMarkdownEmbeddableAsset", () => {
  it("isSvgFile is true only for .svg", () => {
    expect(isSvgFile("/vault/logo.svg")).toBe(true);
    expect(isSvgFile("/vault/logo.png")).toBe(false);
    expect(isSvgFile(undefined)).toBe(false);
  });

  it("covers images and svg — the things markdown embeds with ![](…)", () => {
    for (const p of ["a.png", "a.jpg", "a.gif", "a.webp", "a.avif", "a.svg"]) {
      expect(isMarkdownEmbeddableAsset(p), p).toBe(true);
    }
  });

  /**
   * PDF·HTML은 그 문법으로 넣을 수 없어 위키링크가 유일한 지목 수단이다(§278).
   * 여기에 딸려 들어가면 §278이 되돌려진다.
   */
  it("does NOT cover pdf, html or markdown", () => {
    for (const p of ["a.pdf", "a.html", "a.md"]) {
      expect(isMarkdownEmbeddableAsset(p), p).toBe(false);
    }
  });
});
