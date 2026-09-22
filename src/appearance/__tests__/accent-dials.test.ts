// §367 강조색 다이얼. 저장하는 것은 **이동량**이고, 그것이 기본값 0 을 모든
// 테마에서 참으로 만든다(§364.2 희소성).
import type { DialContext } from "../dials";

import { describe, expect, it } from "vitest";

import { defaultColorsForBase } from "../../types/theme";
import { colorDialVars } from "../apply";
import { hexToHsl } from "../color-hsl";
import { DIALS } from "../dials";
import { resolveDials } from "../merge";

const HUE = DIALS.find((d) => d.id === "accentHueShift");
const SAT = DIALS.find((d) => d.id === "accentSaturationShift");
const ACCENT_KEYS = [
  "--color-accent-ai",
  "--color-accent-default",
  "--color-accent-hover",
  "--color-accent-subtle",
];

function ctx(mode: "dark" | "light"): DialContext {
  return { mode, seeds: defaultColorsForBase(mode) };
}

describe("강조색 다이얼", () => {
  it("둘 다 색 채널이고 네 강조 시드를 선언한다", () => {
    for (const dial of [HUE, SAT]) {
      expect(dial?.channel).toBe("color");
      expect([...(dial?.vars ?? [])].sort()).toEqual([...ACCENT_KEYS].sort());
    }
  });

  // 무엇이 이것을 실패시키는가: 0 에서 변수를 내면 `system` 에서 강조색이
  // 인라인으로 박혀 OS 전환이 그 계열만 못 따라간다(§364.2 가 기록한 사고).
  it("이동량 0 은 아무것도 내지 않는다", () => {
    expect(HUE?.toVars(0, ctx("light"))).toEqual({});
    expect(SAT?.toVars(0, ctx("light"))).toEqual({});
  });

  it("색상 이동은 네 시드를 같은 각도로 돌린다", () => {
    const out = HUE?.toVars(60, ctx("light")) ?? {};
    expect(Object.keys(out).sort()).toEqual([...ACCENT_KEYS].sort());
    const seeds = defaultColorsForBase("light");
    for (const key of ACCENT_KEYS) {
      const before = hexToHsl(seeds[key as keyof typeof seeds])!;
      const after = hexToHsl(out[key]!)!;
      expect(((after.h - before.h + 540) % 360) - 180, key).toBeCloseTo(
        60 - 0,
        0,
      );
      expect(after.s, key).toBeCloseTo(before.s, 0);
      expect(after.l, key).toBeCloseTo(before.l, 0);
    }
  });

  // 실측한 값을 그대로 고정한다(계획 0095, 2026-09-22 전사).
  it("기본 라이트 팔레트에서 +60° 는 측정한 hex 를 낸다", () => {
    expect(HUE?.toVars(60, ctx("light"))).toEqual({
      "--color-accent-ai": "#f65cc7",
      "--color-accent-default": "#af3bf6",
      "--color-accent-hover": "#ad25eb",
      "--color-accent-subtle": "#f8efff",
    });
  });

  // ‼️ 이 계획이 "첫 모드 의존 다이얼" 이라고 부르는 것의 시험이다.
  // 무엇이 이것을 실패시키는가: `toVars` 가 `ctx.seeds` 대신 고정 팔레트를 쓰면
  // 두 결과가 같아진다 — 그러면 모드 의존이 없는 것이다.
  it("같은 값이 모드마다 다른 hex 를 낸다", () => {
    expect(HUE?.toVars(60, ctx("dark"))).toEqual({
      "--color-accent-ai": "#fa8bde",
      "--color-accent-default": "#b560fa",
      "--color-accent-hover": "#af3bf6",
      "--color-accent-subtle": "#461754",
    });
  });

  it("채도 이동은 색상·명도를 보존한다", () => {
    const out = SAT?.toVars(-40, ctx("light")) ?? {};
    expect(out["--color-accent-default"]).toBe("#648ccd");
  });

  it("시드에 없는 강조 키는 내지 않는다", () => {
    const partial: DialContext = {
      mode: "light",
      seeds: { "--color-accent-default": "#3b82f6" },
    };
    expect(Object.keys(HUE?.toVars(60, partial) ?? {})).toEqual([
      "--color-accent-default",
    ]);
  });

  it("파싱 불가한 시드는 건너뛴다", () => {
    const bad: DialContext = {
      mode: "light",
      seeds: { "--color-accent-default": "var(--x)" },
    };
    expect(HUE?.toVars(60, bad)).toEqual({});
  });

  it("범위 밖 값은 parse 가 버린다", () => {
    expect(HUE?.parse(181)).toBeUndefined();
    expect(HUE?.parse(-181)).toBeUndefined();
    expect(HUE?.parse(180)).toBe(180);
    expect(SAT?.parse(51)).toBeUndefined();
    expect(SAT?.parse(-50)).toBe(-50);
    expect(HUE?.parse("60")).toBeUndefined();
  });
});

// §367 리뷰 C1 — **두 다이얼은 한 색의 두 축이다.**
//
// 위 describe 는 축을 하나씩만 시험한다. 그것이 이 결함이 살아남은 이유다: 색상과
// 채도가 둘 다 강조 시드 네 키를 **전부** 내므로, 적용 경로가 다이얼마다 결과를
// 합치면 `DIALS` 에서 뒤에 오는 쪽이 앞의 것을 통째로 덮는다. 그래서 여기서는
// `toVars` 가 아니라 실제 적용 경로(`colorDialVars`)를 부른다.
describe("강조 두 축의 합성 (리뷰 C1)", () => {
  function both(hue: number, saturation: number): Record<string, string> {
    return colorDialVars(
      resolveDials(
        {},
        { accentHueShift: hue, accentSaturationShift: saturation },
      ),
      ctx("light"),
    );
  }

  // 실측한 값을 그대로 고정한다(2026-09-22, 기본 라이트 팔레트).
  it("두 축을 함께 주면 색상과 채도가 둘 다 움직인 hex 를 낸다", () => {
    expect(both(60, -40)).toEqual({
      "--color-accent-ai": "#d47eba",
      "--color-accent-default": "#a564cd",
      "--color-accent-hover": "#9b55bb",
      "--color-accent-subtle": "#f8f2fc",
    });
  });

  // 위 hex 표가 "무엇이 움직였는가" 를 말해 주지는 않는다 — 이것이 그 질문에 답한다.
  //
  // 허용 오차 3 이 각 축의 슬라이더 눈금(1)보다 큰 이유는 왕복 양자화다: 결과는 8비트
  // sRGB 이므로 명도가 극단인 시드에서 HSL 좌표가 성기게 놓인다. 실측(같은 날, 네
  // 시드): 색상 이동은 +59.83°·+59.92°·+59.96°·+62.25°, 채도 이동은 -39.53·-40.00·
  // -40.34·-37.50 이고, 가장 먼 것이 명도 96.9% 인 `accent-subtle` 이다 — 두 축 모두
  // 최대 편차가 2.5 이하이므로 3 은 그것을 담고 "한 축이 안 움직였다"(편차 40·60)는
  // 담지 않는다.
  it("네 시드 전부에서 색상은 +60°, 채도는 -40pt 만큼 움직인다", () => {
    const out = both(60, -40);
    const seeds = defaultColorsForBase("light");
    for (const key of ACCENT_KEYS) {
      const before = hexToHsl(seeds[key as keyof typeof seeds])!;
      const after = hexToHsl(out[key]!)!;
      const hueMoved = ((after.h - before.h + 540) % 360) - 180;
      expect(Math.abs(hueMoved - 60), key).toBeLessThan(3);
      expect(Math.abs(after.s - before.s + 40), key).toBeLessThan(3);
    }
  });

  // ‼️ 회귀의 본체. 고치기 전에는 `DIALS` 에서 뒤에 오는 채도가 색상을 통째로 덮어
  // 이 셋이 **바이트 단위로 같았다** — 채도를 옮겨 둔 채 색상 슬라이더를 끌면 값은
  // 저장되고 화면은 변하지 않는 모양이다.
  it("두 축의 결과는 어느 한 축만 준 결과와도 다르다", () => {
    expect(both(60, -40)).not.toEqual(both(0, -40));
    expect(both(60, -40)).not.toEqual(both(60, 0));
  });

  // 희소성(§364.2)은 그대로다. 무엇이 이것을 실패시키는가: 두 축을 합치면서 "둘 중
  // 하나라도 있으면 낸다" 로 풀면, 둘 다 기본값인 `system` 사용자에게 강조 계열이
  // 인라인으로 박혀 OS 전환이 그 계열만 못 따라간다.
  it("두 축이 모두 기본값이면 아무것도 내지 않는다", () => {
    expect(both(0, 0)).toEqual({});
  });

  // 한 축만 움직인 경우의 동작은 이 변경 전과 같아야 한다 — 그 기준이 축별 `toVars` 다.
  it("한 축만 움직이면 그 다이얼 혼자 계산한 것과 같다", () => {
    expect(both(60, 0)).toEqual(HUE?.toVars(60, ctx("light")));
    expect(both(0, -40)).toEqual(SAT?.toVars(-40, ctx("light")));
  });
});
