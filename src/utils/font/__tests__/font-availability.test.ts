// §351 서체 가용성 판정 — 스펙 0060 §7.2 가 더한 "theme" 갈래.
import { describe, expect, it } from "vitest";

import { fontAvailability } from "../font-availability";

describe("fontAvailability — theme", () => {
  // 테마가 실어 온 서체는 열거에 없어도 렌더된다.
  it("테마 패밀리는 theme — 열거가 아직 없어도", () => {
    const theme = new Set(["theme serif"]);
    expect(fontAvailability("Theme Serif", null, theme)).toBe("theme");
    expect(fontAvailability("Theme Serif", [], theme)).toBe("theme");
  });

  // 비공허성: 집합을 넘기지 않으면 오늘 동작 그대로다.
  it("집합이 없으면 열거에 없는 이름은 missing", () => {
    expect(fontAvailability("Theme Serif", [])).toBe("missing");
  });

  // 번들 이름이 테마 집합에 있어도 번들이 먼저다 — 배지가 "기본 제공" 에서 바뀌지 않게.
  it("번들 서체는 테마 집합보다 먼저 bundled", () => {
    const theme = new Set(["pretendard variable"]);
    expect(fontAvailability("Pretendard Variable", [], theme)).toBe("bundled");
  });
});
