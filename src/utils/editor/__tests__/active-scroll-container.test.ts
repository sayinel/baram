// §288 규칙 4 — 스크롤 컨테이너가 여러 개일 때 활성인 것을 고른다.
//
// ‼️ 단정이 "무언가를 찾았다"가 아니라 "숨은 쪽이 아니라 활성 쪽을 찾았다"인 것이 요점이다.
// 문서 순서상 숨은 컨테이너가 먼저 오도록 배치해, 순진한 querySelector가 실패하게 만든다.
import { afterEach, describe, expect, it } from "vitest";

import { activeEditorScrollContainer } from "../active-scroll-container";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("activeEditorScrollContainer", () => {
  it("prefers the [data-editor-active] container over an earlier hidden one", () => {
    document.body.innerHTML = `
      <div class="editor-area-scroll" id="hidden"></div>
      <div class="editor-area-scroll" data-editor-active id="live"></div>
    `;
    expect(activeEditorScrollContainer()?.id).toBe("live");
  });

  it("falls back to the first container when none is marked active", () => {
    document.body.innerHTML = `<div class="editor-area-scroll" id="only"></div>`;
    expect(activeEditorScrollContainer()?.id).toBe("only");
  });

  it("returns null when there is no container at all", () => {
    expect(activeEditorScrollContainer()).toBeNull();
  });
});
