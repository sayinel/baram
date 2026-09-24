// §365 다이얼 4·5 — 스펙 0057 §7 검사 1·3·4.
import { describe, expect, it } from "vitest";

import { RADIUS_SCALE, SPACE_SCALE } from "../../types/generated/scale";
import { DIALS } from "../dials";

const CTX = { mode: "light", seeds: {} } as const;
const FIXED = ["--radius-full", "--radius-none", "--space-0", "--space-px"];

const dial = (id: "cornerRadius" | "density") => {
  const found = DIALS.find((d) => d.id === id);
  if (found?.kind !== "enum") throw new Error(`${id} is not an enum dial`);
  return found;
};

// 검사 1 — 스펙 0057 §3 의 표를 리터럴로 옮겨 적었다. 무엇이 이것을 실패시키는가:
// 곱수를 바꾸거나 반올림을 ties-up(Math.round)으로 바꾸면 `--space-1-5` 의
// 4px/7px 와 `--space-0-5` 의 1px 가 먼저 어긋난다.
const COMPACT = {
  "--space-0-5": "1px",
  "--space-1": "3px",
  "--space-1-5": "4px",
  "--space-2": "6px",
  "--space-3": "9px",
  "--space-4": "12px",
  "--space-5": "15px",
  "--space-6": "18px",
  "--space-8": "24px",
  "--space-10": "30px",
  "--space-12": "36px",
  "--space-16": "48px",
  "--space-20": "60px",
  "--space-24": "72px",
};
const SPACIOUS = {
  "--space-0-5": "2px",
  "--space-1": "5px",
  "--space-1-5": "7px",
  "--space-2": "10px",
  "--space-3": "15px",
  "--space-4": "20px",
  "--space-5": "25px",
  "--space-6": "30px",
  "--space-8": "40px",
  "--space-10": "50px",
  "--space-12": "60px",
  "--space-16": "80px",
  "--space-20": "100px",
  "--space-24": "120px",
};
const SHARP = {
  "--radius-sm": "0px",
  "--radius-default": "0px",
  "--radius-md": "0px",
  "--radius-lg": "0px",
  "--radius-xl": "0px",
  "--radius-2xl": "0px",
};
const ROUND = {
  "--radius-sm": "3px",
  "--radius-default": "6px",
  "--radius-md": "9px",
  "--radius-lg": "12px",
  "--radius-xl": "18px",
  "--radius-2xl": "24px",
};

describe("§365 밀도·모서리 — 단별 값", () => {
  it.each([
    ["density", "compact", COMPACT],
    ["density", "spacious", SPACIOUS],
    ["cornerRadius", "sharp", SHARP],
    ["cornerRadius", "round", ROUND],
  ] as const)("%s = %s 는 스펙의 표와 같다", (id, option, table) => {
    expect(dial(id).toVars(option, CTX)).toEqual(table);
  });

  // 검사 4 — 희소성(§364.2). 무엇이 이것을 실패시키는가: 곱수 1 을 그대로 계산해
  // 기준값을 인라인으로 쓰면 `system` 의 cascade 를 누른다(`apply.ts` 머리 주석).
  it.each(["density", "cornerRadius"] as const)(
    "%s = default 는 빈 맵이다",
    (id) => {
      expect(dial(id).toVars("default", CTX)).toEqual({});
    },
  );
});

describe("§365 밀도·모서리 — 구조", () => {
  // 검사 4 — 무엇이 이것을 실패시키는가: 필터를 빠뜨려 헤어라인(`--space-px`)이나
  // 알약(`--radius-full`)을 곱하면 여기서 잡힌다(0058 §8.1).
  it("곱하지 않는 넷은 어느 단에서도 나오지 않는다", () => {
    for (const id of ["density", "cornerRadius"] as const) {
      for (const option of dial(id).options) {
        const emitted = Object.keys(dial(id).toVars(option, CTX));
        for (const name of FIXED) expect(emitted).not.toContain(name);
      }
    }
  });

  // 검사 4 — vars 는 clearDialVars 가 지우는 목록이다. 정확히 움직이는 토큰이어야
  // 되돌리기가 값을 남기지 않고(적으면), 곱하지 않는 토큰을 지우지 않는다(많으면 —
  // 인라인이 없던 토큰이라 무해하지만 계약이 흐려진다).
  it("vars 는 움직이는 토큰 14 · 6 개다", () => {
    const moving = (scale: typeof SPACE_SCALE) =>
      scale.map(([name]) => name).filter((name) => !FIXED.includes(name));
    expect(dial("density").vars).toEqual(moving(SPACE_SCALE));
    expect(dial("cornerRadius").vars).toEqual(moving(RADIUS_SCALE));
    expect(dial("density").vars).toHaveLength(14);
    expect(dial("cornerRadius").vars).toHaveLength(6);
  });

  // 검사 3 — 무엇이 이것을 실패시키는가: 곱수를 더 줄여 두 단이 같은 px 가 되면
  // (예: ×0.5 에서 `--space-1-5` 3px 와 `--space-1` 2px 는 갈리지만 ×0.4 에서는
  // 둘 다 2px) 스케일이 단을 잃는다. `sharp` 는 전부 0 이라 정의상 제외한다.
  it("각 단 안에서 움직이는 토큰은 스케일 순서대로 순증가한다", () => {
    const cases = [
      ["density", "compact"],
      ["density", "spacious"],
      ["cornerRadius", "round"],
    ] as const;
    for (const [id, option] of cases) {
      const vars = dial(id).toVars(option, CTX);
      const px = dial(id).vars.map((name) => Number.parseInt(vars[name], 10));
      for (let i = 1; i < px.length; i++) {
        expect(px[i], `${id}=${option} ${dial(id).vars[i]}`).toBeGreaterThan(
          px[i - 1],
        );
      }
    }
  });
});
