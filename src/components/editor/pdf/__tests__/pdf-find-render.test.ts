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
    renderMatches(
      divs,
      [{ begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 5 } }],
      -1,
    );

    const marks = divs[1].querySelectorAll(".pdf-find-match");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("world");
    // 전체 텍스트는 보존된다
    expect(divs[1].textContent).toBe("world");
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
    renderMatches(
      divs,
      [
        { begin: { divIdx: 0, offset: 0 }, end: { divIdx: 0, offset: 5 } },
        { begin: { divIdx: 2, offset: 1 }, end: { divIdx: 2, offset: 6 } },
      ],
      1,
    );

    expect(divs[0].querySelector(".pdf-find-match-current")).toBeNull();
    expect(divs[2].querySelector(".pdf-find-match-current")).not.toBeNull();
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
});
