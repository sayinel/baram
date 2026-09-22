// §367 강조색 다이얼. 저장하는 것은 **이동량**이고, 그것이 기본값 0 을 모든
// 테마에서 참으로 만든다(§364.2 희소성).
import type { DialContext } from "../dials";

import { describe, expect, it } from "vitest";

import { defaultColorsForBase } from "../../types/theme";
import { hexToHsl } from "../color-hsl";
import { DIALS } from "../dials";

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
