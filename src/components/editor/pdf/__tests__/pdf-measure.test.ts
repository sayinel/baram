import { describe, expect, it } from "vitest";

import { nextContainerWidth } from "../pdf-measure";

describe("nextContainerWidth", () => {
  it("takes a real measurement", () => {
    expect(nextContainerWidth(820, 640)).toBe(820);
  });

  it("keeps the last width when the element is out of layout (display:none → 0)", () => {
    expect(nextContainerWidth(0, 640)).toBe(640);
  });

  it("keeps 0 when there was never a real measurement", () => {
    // 첫 마운트가 숨은 상태일 수 있다. 그때는 유지할 값이 없으므로 0이 맞다 —
    // 보이게 되는 순간 옵저버가 진짜 폭을 실어 온다.
    expect(nextContainerWidth(0, 0)).toBe(0);
  });

  it("ignores a negative width (jsdom / detached elements report these)", () => {
    expect(nextContainerWidth(-5, 640)).toBe(640);
  });
});
