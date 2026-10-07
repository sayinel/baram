import { describe, expect, it } from "vitest";

import { toRelativePath, toWikilinkLabel } from "../file-tree-clipboard";

describe("toRelativePath", () => {
  it("vault 루트 기준 상대 경로를 선행 슬래시 없이 반환한다", () => {
    expect(toRelativePath("/r/docs/a.md", "/r")).toBe("docs/a.md");
  });
  it("루트 바로 아래 파일은 파일명만 반환한다", () => {
    expect(toRelativePath("/r/a.md", "/r")).toBe("a.md");
  });
  it("루트 밖 경로는 절대 경로를 그대로 반환한다", () => {
    expect(toRelativePath("/other/a.md", "/r")).toBe("/other/a.md");
  });
});

describe("toWikilinkLabel", () => {
  const paths = ["/r/a.md", "/r/docs/a.md", "/r/unique.md"];
  it("파일명이 유일하면 확장자 제거한 파일명을 반환한다", () => {
    expect(toWikilinkLabel("/r/unique.md", "/r", paths)).toBe("unique");
  });
  it("동명(확장자 제거) 파일이 2개 이상이면 확장자 제거한 상대 경로를 반환한다", () => {
    expect(toWikilinkLabel("/r/docs/a.md", "/r", paths)).toBe("docs/a");
    expect(toWikilinkLabel("/r/a.md", "/r", paths)).toBe("a");
  });
  it("확장자 없는 파일은 파일명을 그대로 쓴다", () => {
    expect(toWikilinkLabel("/r/README", "/r", ["/r/README"])).toBe("README");
  });
});

describe("§390 toWikilinkLabel across normalization", () => {
  const NOTE = "노트";
  const NOTE_NFD = NOTE.normalize("NFD");

  it("writes a name stored decomposed composed (D7)", () => {
    // What fails this: the label keeping the stored spelling.
    expect(NOTE_NFD).not.toBe(NOTE);
    expect(
      toWikilinkLabel(`/r/${NOTE_NFD}.md`, "/r", [`/r/${NOTE_NFD}.md`]),
    ).toBe(NOTE);
  });

  it("counts a name stored both ways as one name, and qualifies both", () => {
    // What fails this: the collision check comparing bytes — the two names
    // then look unique, and `[[노트]]` is copied for a name the link index
    // reads as two notes.
    const paths = [`/r/a/${NOTE}.md`, `/r/b/${NOTE_NFD}.md`];
    expect(toWikilinkLabel(paths[0], "/r", paths)).toBe(`a/${NOTE}`);
    expect(toWikilinkLabel(paths[1], "/r", paths)).toBe(`b/${NOTE}`);
  });

  it("counts names that differ only in case as one name, and qualifies both", () => {
    // What fails this: the collision check composing the name but not
    // lowercasing it — `foldName` replaced by NFC alone — so the two look
    // unique and `[[Note]]` is copied for a name the link index reads as one
    // key.
    const paths = ["/r/a/Note.md", "/r/b/note.md"];
    expect(toWikilinkLabel(paths[0], "/r", paths)).toBe("a/Note");
    expect(toWikilinkLabel(paths[1], "/r", paths)).toBe("b/note");
  });
});
