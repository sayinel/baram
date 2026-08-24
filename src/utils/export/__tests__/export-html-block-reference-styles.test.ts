// §276.4/§276.6 export-html.ts clones the live editor DOM, so an area-highlight
// reference reaches the export as a wrapper span carrying `data-area-preview`,
// an inline `width: N%` and `data-sized`, wrapped around the crop's <img>.
// Before these rules existed the export stylesheet knew only the plain chip, so
// a resized reference exported as a 60%-wide box wearing the purple chip frame
// around a natural-size image that overflowed it.
//
// Asserted through jsdom's cascade rather than by grepping the stylesheet: a
// substring match proves a rule was written, not that it wins over the chip
// rule it has to override.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildExportStylesheet } from "../export-html-styles";

const AREA_IMAGE = `<img class="block-reference-area-image" src="data:image/png;base64,AAAA" width="320" height="90">`;

/** jsdom serializes `transparent` as its rgba() equivalent. */
const TRANSPARENT = "rgba(0, 0, 0, 0)";

let style: HTMLStyleElement;

beforeAll(() => {
  style = document.createElement("style");
  style.textContent = buildExportStylesheet();
  document.head.append(style);
});

afterAll(() => {
  style.remove();
  document.body.innerHTML = "";
});

/** Render export-shaped markup and hand back the pieces worth asserting on. */
function mount(attrs: string): { img: HTMLElement; wrapper: HTMLElement } {
  // Inside the export wrapper, because the stylesheet is now the editor's own
  // rescoped onto it — markup mounted bare would miss every scoped rule and
  // the cascade under test would not be the one that ships.
  document.body.innerHTML = `<article class="baram-export"><p><span class="block-reference" ${attrs}>${AREA_IMAGE}</span></p></article>`;
  return {
    img: document.querySelector(".block-reference-area-image") as HTMLElement,
    wrapper: document.querySelector(".block-reference") as HTMLElement,
  };
}

describe("exported block-reference styles", () => {
  it("drops the chip frame around an area preview", () => {
    // 그림 둘레의 보라색 칩 테두리는 링크가 아니라 렌더링 버그로 읽힌다.
    const { wrapper } = mount(`data-area-preview="true"`);
    const css = getComputedStyle(wrapper);

    expect(css.display).toBe("inline-block");
    expect(css.padding).toBe("0px");
    // borderStyle, not the `border` shorthand: jsdom re-serializes that one
    // from the longhands and keeps the chip rule's colour in the string even
    // once the style is `none`.
    expect(css.borderStyle).toBe("none");
    expect(css.backgroundColor).toBe(TRANSPARENT);
    expect(css.maxWidth).toBe("100%");
  });

  it("keeps the chip frame for an ordinary reference", () => {
    // 판별력: 위 규칙이 [data-area-preview] 없이 쓰였다면 여기가 빨개진다.
    const { wrapper } = mount("");
    const css = getComputedStyle(wrapper);

    expect(css.display).not.toBe("inline-block");
    expect(css.padding).toBe("0px 4px");
    expect(css.backgroundColor).not.toBe(TRANSPARENT);
  });

  it("makes the crop fill a resized reference", () => {
    // ‼️ 이게 없으면 래퍼만 60%로 넓어지고 이미지는 자연 크기로 남아 박스를
    // 넘친다 — max-width는 줄일 수만 있고 다시 키우지 못한다.
    const { img } = mount(
      `data-area-preview="true" data-sized="true" style="width: 60%"`,
    );

    expect(getComputedStyle(img).width).toBe("100%");
  });

  it("leaves an unsized crop at its natural size", () => {
    const { img } = mount(`data-area-preview="true"`);
    const css = getComputedStyle(img);

    expect(css.width).not.toBe("100%");
    // …but still clamped to the column, as in the editor.
    expect(css.maxWidth).toBe("100%");
    expect(css.height).toBe("auto");
  });

  it("carries the wrapper's inline percentage into the export", () => {
    const { wrapper } = mount(
      `data-area-preview="true" data-sized="true" style="width: 60%"`,
    );

    expect(getComputedStyle(wrapper).width).toBe("60%");
  });
});
