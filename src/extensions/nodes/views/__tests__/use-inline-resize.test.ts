import { afterEach, describe, expect, it } from "vitest";

import {
  computeInlineResizePct,
  resolveContainingBlock,
} from "../use-inline-resize";
import { computeResizePct } from "../use-media-resize";

describe("computeInlineResizePct", () => {
  const W = 1000;
  const LEFT = 0;

  it("measures the width from the element's own left edge, never doubling it", () => {
    // ‼️ 이 파일의 이유. 300px 오른쪽으로 끌면 폭은 300px = 30%다.
    // 가운데 정렬 블록용 computeResizePct는 같은 입력에 60을 낸다 —
    // 인라인 참조에 그 식을 쓰면 폭이 두 배로 튄다.
    expect(computeInlineResizePct(300, LEFT, W)).toBe(30);
    expect(computeResizePct(300, LEFT, W)).toBe(60);
  });

  it("anchors to the element's left edge, not the container's", () => {
    // 참조가 문단 중간(200px)에서 시작해도 폭은 커서까지의 거리다.
    expect(computeInlineResizePct(500, 200, W)).toBe(30);
  });

  it("snaps to the nearest 10% within ±3%", () => {
    expect(computeInlineResizePct(570, LEFT, W)).toBe(60); // 57 → 60
    expect(computeInlineResizePct(530, LEFT, W)).toBe(50); // 53 → 50 (경계)
    expect(computeInlineResizePct(470, LEFT, W)).toBe(50); // 47 → 50 (경계)
  });

  it("leaves values outside the ±3% snap window untouched", () => {
    expect(computeInlineResizePct(540, LEFT, W)).toBe(54); // 50에서 4% → 그대로
    expect(computeInlineResizePct(660, LEFT, W)).toBe(66); // 70에서 4% → 그대로
  });

  it("clamps to a 10% minimum, including a cursor left of the anchor", () => {
    expect(computeInlineResizePct(LEFT, LEFT, W)).toBe(10); // 거리 0
    expect(computeInlineResizePct(50, LEFT, W)).toBe(10); // 5% → 10%
    expect(computeInlineResizePct(-400, LEFT, W)).toBe(10); // 음수 폭
  });

  it("clamps to a 100% maximum past the container's right edge", () => {
    expect(computeInlineResizePct(9999, LEFT, W)).toBe(100);
  });

  it("falls back to 100 for a zero-width or negative container", () => {
    expect(computeInlineResizePct(300, LEFT, 0)).toBe(100);
    expect(computeInlineResizePct(300, LEFT, -50)).toBe(100);
  });
});

describe("resolveContainingBlock", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  /** Build a tree in the document (getComputedStyle needs it attached). */
  function mountHtml(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.querySelector("[data-target]") as HTMLElement;
  }

  it("skips the inline wrapper @tiptap/react puts around every NodeView", () => {
    // ‼️ CRITICAL-1. `span.react-renderer` has no CSS rule in this codebase, so
    // it is display:inline and its box is exactly its one inline-block child —
    // the reference itself. Taking parentElement measured the crop and then
    // committed the result as a fraction of the paragraph.
    const el = mountHtml(
      `<p id="para">text <span class="react-renderer"><span data-target></span></span></p>`,
    );

    expect(resolveContainingBlock(el)?.id).toBe("para");
  });

  it.each([
    [
      "a table cell",
      `<table><tbody><tr><td id="host"><span data-target></span></td></tr></tbody></table>`,
    ],
    ["a list item", `<ul><li id="host"><span data-target></span></li></ul>`],
    [
      "a blockquote",
      `<blockquote id="host"><span data-target></span></blockquote>`,
    ],
    ["a heading", `<h2 id="host"><span data-target></span></h2>`],
  ])("resolves %s as the containing block", (_label, html) => {
    expect(resolveContainingBlock(mountHtml(html))?.id).toBe("host");
  });

  it("walks past several nested inline ancestors", () => {
    const el = mountHtml(
      `<p id="para"><em><strong><span><span data-target></span></span></strong></em></p>`,
    );

    expect(resolveContainingBlock(el)?.id).toBe("para");
  });

  it("returns null for a detached subtree rather than guessing", () => {
    // Refusing is what makes the drag no-op instead of committing a width
    // measured against nothing.
    const wrapper = document.createElement("span");
    const el = document.createElement("span");
    wrapper.append(el);

    expect(resolveContainingBlock(el)).toBeNull();
  });
});
