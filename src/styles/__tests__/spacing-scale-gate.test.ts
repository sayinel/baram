// 규칙이 조용히 느슨해지는 것을 막는다. stylelint 설정은 주석 한 줄로 무력화되고
// (`"declaration-property-value-disallowed-list": null`) 그러면 CI 는 계속 초록이다.
//
// 무엇이 이것을 실패시키는가: 규칙을 지우거나, 간격·모서리 중 한쪽만 남기거나,
// disable 주석이 이유 없이 붙으면 실패한다.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

import { cssFiles } from "./css-rules";

it("간격과 모서리 양쪽에 리터럴 px 금지가 걸려 있다", () => {
  const cfg = readFileSync("stylelint.config.mjs", "utf8");
  expect(cfg).toMatch(/declaration-property-value-disallowed-list/u);
  expect(cfg).toMatch(/padding\|margin\|gap/u);
  expect(cfg).toMatch(/radius/u);
});

// 이유 없는 무력화를 막는다 — `--` 뒤에 설명이 있어야 stylelint 가 이유로 읽는다.
it("규칙을 끄는 주석에는 전부 이유가 붙어 있다", () => {
  const offenders: string[] = [];
  // ‼️ `cssRules()` 를 쓰지 않는다 — 그 함수는 파싱 전에 주석을 지운다
  // (`css-rules.ts` 의 `cssRules` 안 `.replace(/\/\*[\s\S]*?\*\//gu, "")`).
  // 주석을 찾는 검사가 주석 없는 입력을 받으면 늘 빈 배열을 보고 통과한다.
  for (const file of cssFiles()) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/stylelint-disable[^\n]*/gu)) {
      if (!/--\s+\S/u.test(m[0]!)) offenders.push(`${file}: ${m[0]!}`);
    }
  }
  expect(offenders).toEqual([]);
});
