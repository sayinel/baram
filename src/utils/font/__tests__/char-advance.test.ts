// §365 다이얼 8 — 한 글자 폭의 측정. jsdom 에는 `document.fonts` 도 canvas 측정도 없다 — 그
// 환경에서 이 함수가 던지지 않고 "잴 수 없다" 를 돌려주는지를 본다. 실제 측정은 앱에서 확인한다
// (impl-notes 의 수동 확인 절차).
import { describe, expect, it } from "vitest";

import { ADVANCE_SAMPLES, measureAdvanceRatio } from "../char-advance";

describe("measureAdvanceRatio", () => {
  it("잴 수 없는 환경에서는 null", async () => {
    await expect(
      measureAdvanceRatio('"Pretendard Variable"', ADVANCE_SAMPLES.ko),
    ).resolves.toBeNull();
  });

  it("표본은 로케일마다 하나", () => {
    expect(ADVANCE_SAMPLES).toEqual({
      en: "abcdefghijklmnopqrstuvwxyz",
      ko: "가",
    });
  });
});
