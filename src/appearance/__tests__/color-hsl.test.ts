// §367 파생은 색상환 회전을 쓴다. 그 변환이 값을 잃으면 파생 전체가 조용히 어긋나므로
// 왕복 무손실을 먼저 고정한다.
import { describe, expect, it } from "vitest";

import { hexToHsl, hslToHex } from "../color-hsl";

/** `color-contrast.test.ts` 의 같은 이름 생성기와 같은 모양 — 격자를 성기게 잡아 빠르게 유지한다. */
function* srgbGrid(step: number): Generator<string> {
  for (let r = 0; r < 256; r += step) {
    for (let g = 0; g < 256; g += step) {
      for (let b = 0; b < 256; b += step) {
        yield `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
      }
    }
  }
}

describe("hexToHsl / hslToHex", () => {
  // 무엇이 이것을 실패시키는가: 반올림을 한 번만 잘못 넣어도(예: h 를 정수로
  // 자르면) 채널이 1 씩 밀린다. 그 오차는 파생된 13개 callout 색에 누적된다.
  //
  // ‼️ 이 격자는 표본이다. 전수(16,777,216색)를 계획 작성 시점에 한 번 돌려
  // **최대 채널 오차 0** 을 확인했다(2026-09-22). 격자를 쓰는 이유는 CI 시간뿐이다.
  it("sRGB 격자 전체에서 왕복이 정확하다", () => {
    let worst = 0;
    let worstColor = "";
    for (const hex of srgbGrid(5)) {
      const hsl = hexToHsl(hex);
      expect(hsl, hex).not.toBeNull();
      const back = hslToHex(hsl!);
      if (back !== hex) {
        worst = 1;
        worstColor = `${hex} -> ${back}`;
      }
    }
    expect(worst, worstColor).toBe(0);
  });

  it("측정한 기본 팔레트 강조색의 HSL 을 고정한다", () => {
    // 출처: src/types/generated/palette-{light,dark}.ts (2026-09-22 전사).
    // 이 값들이 Task 5 의 명도 보존이 무엇을 보존하는지 말해 준다.
    const light = hexToHsl("#3b82f6")!;
    expect(light.h).toBeCloseTo(217.2, 1);
    expect(light.s).toBeCloseTo(91.2, 1);
    expect(light.l).toBeCloseTo(59.8, 1);
    const dark = hexToHsl("#60a5fa")!;
    expect(dark.h).toBeCloseTo(213.1, 1);
    expect(dark.s).toBeCloseTo(93.9, 1);
    expect(dark.l).toBeCloseTo(67.8, 1);
  });

  it("무채색은 색상 0 · 채도 0 이다", () => {
    expect(hexToHsl("#1a1a1a")).toEqual({
      h: 0,
      l: expect.closeTo(10.2, 1),
      s: 0,
    });
  });

  it("3자리 hex 를 편다", () => {
    expect(hslToHex(hexToHsl("#fff")!)).toBe("#ffffff");
  });

  // 부정 단언의 짝 — 이 함수가 실제로 거부한다는 것을 보이는 긍정 단언이 위에 있다.
  it("hex 가 아닌 것은 null 이다", () => {
    for (const bad of [
      "var(--x)",
      "#12",
      "#12345",
      "rgb(0 0 0)",
      "",
      "#gggggg",
    ]) {
      expect(hexToHsl(bad), bad).toBeNull();
    }
  });

  // ‼️ alpha 는 **거부**한다. `color-contrast.ts` 의 `parseHexColor` 는 alpha 를 읽고
  // 버리지만(그 주석이 이유를 적는다 — 거부하면 불투명 경로로 새어 #330 이 재발한다),
  // 이쪽은 파생의 **입력**이라 사정이 다르다: 8자리를 절삭해 받아들이면 테마가 실어 온
  // 반투명 시드가 불투명한 파생 29키를 낳고, 그 색들은 어디서 왔는지 설명할 수 없다.
  // 시드 계약(`THEME_COLOR_VALUE_RE`)도 3·6자리만 받는다 — 이 함수가 그 계약과 같다.
  it("alpha hex 는 받지 않는다", () => {
    expect(hexToHsl("#12345678")).toBeNull();
    expect(hexToHsl("#1234")).toBeNull();
  });
});
