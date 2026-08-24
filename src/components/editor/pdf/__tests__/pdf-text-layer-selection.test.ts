// §274 UX fix round 3 (defect A) — resolveSelectionAnchor는
// pdf-text-layer-selection.ts의 유일한 순수 함수다(나머지는 전역
// selectionchange/pointer 리스너와 공유 Map을 건드리는 부수효과라 GUI에서만
// 검증 가능하다, GUI-VERIFICATION.md 참조). 여기서는 pdf.js 원본
// (web/pdf_viewer.mjs)의 anchor 판정 로직이 그대로 옮겨졌는지만 고정한다.
import { afterEach, describe, expect, it } from "vitest";

import { resolveSelectionAnchor } from "../pdf-text-layer-selection";

// 각 테스트가 document.body에 레이어를 붙인다 — "형제가 바닥남" 케이스가
// 이전 테스트의 잔여 노드로 새는 것을 막는다.
afterEach(() => {
  document.body.replaceChildren();
});

/** 텍스트 레이어 컨테이너 하나를 흉내 낸다: <span>Hello</span><br/><span>World</span> */
function makeLayer() {
  const layer = document.createElement("div");
  layer.className = "pdf-text-layer";

  const spanA = document.createElement("span");
  spanA.textContent = "Hello";
  const br = document.createElement("br");
  const spanB = document.createElement("span");
  spanB.textContent = "World";

  layer.append(spanA, br, spanB);
  document.body.append(layer);

  return { br, layer, spanA, spanB };
}

describe("resolveSelectionAnchor", () => {
  it("정방향 드래그(첫 selectionchange, prevRange 없음) — endContainer의 텍스트 노드를 부모 span으로 끌어올린다", () => {
    const { spanA } = makeLayer();
    const range = document.createRange();
    const textNode = spanA.firstChild as Text;
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);

    const { anchor, modifyStart } = resolveSelectionAnchor(range, null);

    expect(modifyStart).toBe(false);
    expect(anchor).toBe(spanA);
  });

  it("역방향 드래그(끝은 그대로, 시작만 바뀜) — startContainer 쪽을 anchor로 삼는다(modifyStart=true)", () => {
    const { spanA, spanB } = makeLayer();
    const endText = spanB.firstChild as Text;
    const startTextInitial = spanB.firstChild as Text;

    const prevRange = document.createRange();
    prevRange.setStart(startTextInitial, 2);
    prevRange.setEnd(endText, 4);

    // 끝(spanB의 offset 4)은 그대로 두고 시작만 앞(spanA)으로 확장 —
    // END_TO_END 비교가 0이 되어 modifyStart가 true여야 한다.
    const range = document.createRange();
    const startTextInA = spanA.firstChild as Text;
    range.setStart(startTextInA, 1);
    range.setEnd(endText, 4);

    const { anchor, modifyStart } = resolveSelectionAnchor(range, prevRange);

    expect(modifyStart).toBe(true);
    expect(anchor).toBe(spanA);
  });

  it("span 시작 경계(offset 0)에서 멈추면 그 span이 아니라 앞의 온전한 형제로 건너뛴다 — 비어 있는 <br>은 통과한다", () => {
    const { br, spanA, spanB } = makeLayer();
    const range = document.createRange();
    // endContainer가 spanB 자신(엘리먼트), endOffset 0 — "spanB의 첫 자식 앞".
    range.setStart(spanB, 0);
    range.setEnd(spanB, 0);

    const { anchor, modifyStart } = resolveSelectionAnchor(range, null);

    expect(modifyStart).toBe(false);
    // br(자식 없음)을 건너뛰고 spanA(자식 있음)에 도달해야 한다.
    expect(anchor).not.toBe(br);
    expect(anchor).toBe(spanA);
  });

  it("건너뛸 형제가 바닥나면(레이어 맨 앞) null을 돌려준다 — 예외를 던지지 않는다", () => {
    const layer = document.createElement("div");
    const onlySpan = document.createElement("span");
    onlySpan.textContent = "Solo";
    layer.append(onlySpan);
    document.body.append(layer);

    const range = document.createRange();
    range.setStart(onlySpan, 0);
    range.setEnd(onlySpan, 0);

    expect(() => resolveSelectionAnchor(range, null)).not.toThrow();
    const { anchor } = resolveSelectionAnchor(range, null);
    expect(anchor).toBeNull();
  });
});
