// §365 밀도·모서리 — 다이얼이 곱하는 기준값이 CSS 와 같은 출처에서 오는가.
import { describe, expect, it } from "vitest";

import primitivesCSS from "../../styles/generated/primitives.css?raw";
import { RADIUS_SCALE, SPACE_SCALE } from "../../types/generated/scale";

type Pair = readonly [string, number];

/** `primitives.css` 의 `--{group}-*: Npx;` 정의 — 선언 순서 그대로. */
function definitions(group: "radius" | "space"): Pair[] {
  const re = new RegExp(String.raw`(--${group}-[a-z0-9-]+):\s*(\d+)px;`, "gu");
  return [...primitivesCSS.matchAll(re)].map((m) => [m[1], Number(m[2])]);
}

const byName = (pairs: readonly Pair[]): Pair[] =>
  [...pairs].sort(([a], [b]) => a.localeCompare(b));

describe("생성 스케일", () => {
  // 무엇이 이것을 실패시키는가: 생성기가 다른 출처를 읽거나 토큰을 빠뜨리면
  // 집합이 갈린다. 개수를 먼저 고정하는 것은 비공허성 때문이다 — 정규식이
  // 깨져 양쪽이 다 비면 아래 toEqual 은 빈 배열끼리 통과한다.
  it("primitives.css 와 같은 24쌍이다", () => {
    expect(definitions("space")).toHaveLength(16);
    expect(definitions("radius")).toHaveLength(8);
    expect(byName(SPACE_SCALE)).toEqual(byName(definitions("space")));
    expect(byName(RADIUS_SCALE)).toEqual(byName(definitions("radius")));
  });

  // 무엇이 이것을 실패시키는가: 생성기가 토큰 JSON 의 키 순서를 그대로 내면
  // `--space-px`·`--space-0-5`·`--space-1-5` 가 맨 뒤로 간다. JS 객체는
  // 정수형 키("1"·"2")를 앞으로 보내고, primitives.css 의 선언 순서가 바로 그
  // 결과다(`--space-24` 다음에 `--space-px`).
  it("값 오름차순이다", () => {
    for (const scale of [SPACE_SCALE, RADIUS_SCALE]) {
      const px = scale.map(([, value]) => value);
      expect(px).toEqual([...px].sort((a, b) => a - b));
    }
  });
});
