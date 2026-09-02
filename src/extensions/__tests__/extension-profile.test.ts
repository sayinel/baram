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

  // §324-e 이 테스트는 원래 "캡처는 document의 부분집합이다"였다. 지금은 아니다 —
  // 캡처만 갖는 Extension이 정확히 하나 있고, 그 하나를 **이름으로** 적어 둔다.
  // "부분집합이 아니다"로 느슨하게 풀면 다음에 무엇이 몰래 들어와도 통과하므로,
  // 여기서 잃는 것이 없도록 추가 집합 자체를 고정한다.
  //
  // `captureSaveKey`가 캡처에만 있는 이유: 캡처 창에서 `Mod+Enter`는 저장이고,
  // HardBreak의 기본 바인딩이 그 키로 하드 브레이크를 넣어 모든 저장 본문 끝에
  // `\`를 남겼다. 문서 편집기에서 `Mod+Enter`는 저장이 아니므로 그쪽은 건드리지
  // 않는다(`extensions/index.ts`의 `CaptureSaveKey` 주석에 측정값이 있다).
  it("캡처만 갖는 Extension은 정확히 `captureSaveKey` 하나다", () => {
    const doc = names({ profile: "document" });
    const extra = new Set(
      [...names({ profile: "capture" })].filter((n) => !doc.has(n)),
    );
    expect(extra).toEqual(new Set(["captureSaveKey"]));
  });
});
