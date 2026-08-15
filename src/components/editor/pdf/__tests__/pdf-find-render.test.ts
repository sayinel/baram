import { beforeEach, describe, expect, it } from "vitest";

import { clearMatches, renderMatches } from "../pdf-find-render";

function makeDivs(texts: string[]): HTMLElement[] {
  return texts.map((t) => {
    const el = document.createElement("span");
    el.textContent = t;
    return el;
  });
}

describe("renderMatches", () => {
  let divs: HTMLElement[];

  beforeEach(() => {
    divs = makeDivs(["Hello ", "world", " again"]);
  });

  it("wraps a match inside one div", () => {
    // 매치는 div 텍스트의 진짜 내부 부분 문자열이어야 한다 — 앞뒤 모두 텍스트가 남는다.
    // "Hello "에서 offset 1→5 = "ello", 앞에 "H", 뒤에 " "가 남는다.
    renderMatches(
      divs,
      [{ begin: { divIdx: 0, offset: 1 }, end: { divIdx: 0, offset: 5 } }],
      -1,
    );

    const marks = divs[0].querySelectorAll(".pdf-find-match");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("ello");
    // 앞뒤 텍스트가 순서대로 텍스트 노드로 남는다
    expect(divs[0].childNodes).toHaveLength(3);
    expect(divs[0].childNodes[0].nodeType).toBe(Node.TEXT_NODE);
    expect(divs[0].childNodes[0].textContent).toBe("H");
    expect(divs[0].childNodes[2].nodeType).toBe(Node.TEXT_NODE);
    expect(divs[0].childNodes[2].textContent).toBe(" ");
    // 전체 텍스트는 보존된다
    expect(divs[0].textContent).toBe("Hello ");
  });

  it("wraps the tail and head when a match spans two divs", () => {
    renderMatches(
      divs,
      [{ begin: { divIdx: 0, offset: 3 }, end: { divIdx: 1, offset: 2 } }],
      -1,
    );

    expect(divs[0].querySelector(".pdf-find-match")?.textContent).toBe("lo ");
    expect(divs[1].querySelector(".pdf-find-match")?.textContent).toBe("wo");
    expect(divs[0].textContent).toBe("Hello ");
    expect(divs[1].textContent).toBe("world");
  });

  it("marks only the current match", () => {
    // 3개 매치, 현재는 마지막이 아니라 중간(idx 1) — "마지막을 current로" 오구현을 잡는다.
    renderMatches(
      divs,
      [
        { begin: { divIdx: 0, offset: 0 }, end: { divIdx: 0, offset: 5 } },
        { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } },
        { begin: { divIdx: 2, offset: 1 }, end: { divIdx: 2, offset: 6 } },
      ],
      1,
    );

    expect(divs[0].querySelector(".pdf-find-match-current")).toBeNull();
    expect(divs[2].querySelector(".pdf-find-match-current")).toBeNull();

    const current = divs[1].querySelector(".pdf-find-match");
    expect(current).not.toBeNull();
    // 현재 매치도 기본 클래스를 함께 가져야 한다 — border-radius/배경 폴백을 잃지 않는다.
    expect(current?.classList.contains("pdf-find-match")).toBe(true);
    expect(current?.classList.contains("pdf-find-match-current")).toBe(true);
  });

  it("restores original text on clear", () => {
    renderMatches(
      divs,
      [{ begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } }],
      -1,
    );
    clearMatches(divs);

    expect(divs[1].querySelector(".pdf-find-match")).toBeNull();
    expect(divs[1].textContent).toBe("world");
  });

  it("is idempotent — re-rendering does not nest marks", () => {
    const positions = [
      { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } },
    ];
    renderMatches(divs, positions, -1);
    renderMatches(divs, positions, -1);

    expect(divs[1].querySelectorAll(".pdf-find-match")).toHaveLength(1);
    expect(divs[1].textContent).toBe("world");
  });

  it("clears a stale highlight when the match set moves to a different div", () => {
    renderMatches(
      divs,
      [{ begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } }],
      -1,
    );
    renderMatches(
      divs,
      [{ begin: { divIdx: 2, offset: 1 }, end: { divIdx: 2, offset: 6 } }],
      -1,
    );

    expect(divs[1].querySelector(".pdf-find-match")).toBeNull();
    expect(divs[1].textContent).toBe("world");
    expect(divs[2].querySelector(".pdf-find-match")).not.toBeNull();
  });

  it("moves the current-match class when only currentIdx changes", () => {
    const positions = [
      { begin: { divIdx: 0, offset: 0 }, end: { divIdx: 0, offset: 5 } },
      { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } },
    ];
    renderMatches(divs, positions, 0);
    renderMatches(divs, positions, 1);

    expect(divs[0].querySelector(".pdf-find-match-current")).toBeNull();
    expect(divs[1].querySelector(".pdf-find-match-current")).not.toBeNull();
  });
});
