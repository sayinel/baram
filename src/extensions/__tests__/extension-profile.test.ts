import { describe, expect, it } from "vitest";

import { CAPTURE_EXCLUDED_EXTENSIONS, createBaramExtensions } from "../index";

const names = (opts?: Parameters<typeof createBaramExtensions>[0]) =>
  new Set(createBaramExtensions(opts).map((e) => e.name));

describe("§323 Extension 프로파일", () => {
  it("기본(document) 프로파일은 지금까지와 같은 세트다", () => {
    expect(names()).toEqual(names({ profile: "document" }));
  });

  it("캡처 프로파일에는 vim·쿼리 블록·AI diff·find-replace가 없다", () => {
    const capture = names({ profile: "capture" });
    for (const excluded of [
      "wysiwygVim",
      "queryBlock",
      "aiDiff",
      "findReplace",
    ]) {
      expect(capture.has(excluded)).toBe(false);
    }
  });

  it("문단·헤딩·리스트·표·수식·이미지·링크·태그·드롭은 캡처에도 남는다", () => {
    const capture = names({ profile: "capture" });
    for (const kept of [
      "paragraph",
      "heading",
      "bulletList",
      "taskList",
      "table",
      "mathBlock",
      "image",
      "link",
      "tagNode",
      "wikilink",
      "dropHandler",
    ]) {
      expect(capture.has(kept)).toBe(true);
    }
  });

  // ‼️ 이 테스트가 배제 방식을 강제한다. 캡처 세트를 열거로 만들면 새 Extension이
  // document에만 생기고 capture에는 안 생겨, 차집합이 배제 목록보다 커진다.
  it("두 프로파일의 차집합은 정확히 배제 목록이다 — 열거 구현을 막는 핀", () => {
    const doc = names({ profile: "document" });
    const capture = names({ profile: "capture" });
    const diff = new Set([...doc].filter((n) => !capture.has(n)));
    expect(diff).toEqual(new Set(CAPTURE_EXCLUDED_EXTENSIONS));
  });

  it("캡처 프로파일이 document에 없는 것을 새로 넣지는 않는다", () => {
    const doc = names({ profile: "document" });
    for (const n of names({ profile: "capture" }))
      expect(doc.has(n)).toBe(true);
  });
});
