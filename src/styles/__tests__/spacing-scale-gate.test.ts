// 규칙이 조용히 느슨해지는 것을 막는다. stylelint 설정은 주석 한 줄로 무력화되고
// (`"declaration-property-value-disallowed-list": null`) 그러면 CI 는 계속 초록이다.
//
// 무엇이 이것을 실패시키는가: 규칙을 지우거나, 간격·모서리 중 한쪽만 남기거나,
// disable 주석이 이유 없이 붙으면 실패한다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { cssFiles } from "./css-rules";

/**
 * `declaration-property-value-disallowed-list` 규칙의 property 키 목록을,
 * 파일을 **평가**해서 얻는다 — 텍스트로 읽지 않는다.
 *
 * ‼️ 왜 텍스트 매치(`toMatch(/radius/u)`)가 아닌가: 리뷰가 radius 키를 지우고
 * 돌려 봤더니 이 테스트가 그대로 초록이었다. 규칙 바로 위 `‼️` 주석과 규칙의
 * `message`("Use a --space-* or --radius-* token") 양쪽 모두에 "radius" 라는 글자가
 * 남아 있어서, 파일 **텍스트** 안 어딘가에 그 단어가 있는지만 보는 검사는
 * 키가 사라져도 계속 통과했다. 주석을 지워도 `message` 가 남아 같은 문제가
 * 재현된다 — 텍스트 매치 자체가 잘못된 도구였다. 규칙 객체의 키를 직접 읽으면
 * 키를 지우는 순간만 빨갛다.
 *
 * `import(...)` 을 정적 문자열이 아니라 변수로 호출하는 것은 우연이 아니다 —
 * 이 프로젝트는 `allowJs` 가 꺼져 있어 `.mjs` 파일을 정적 import 하면
 * `npm run typecheck` 가 선언 파일을 찾지 못해 멎는다. 변수 경로를 쓰면
 * TypeScript 가 모듈을 정적으로 해석하지 않고 반환 타입을 `any` 로 취급해
 * 타입체크를 통과한다(실측: `tsc -p tsconfig.test.json --noEmit` exit 0).
 */
async function disallowedListPropertyKeys(): Promise<string[]> {
  const configPath = resolve(process.cwd(), "stylelint.config.mjs");
  const configUrl = pathToFileURL(configPath).href;
  const mod = await import(configUrl);
  const rule = mod.default.rules["declaration-property-value-disallowed-list"];
  if (!Array.isArray(rule) || typeof rule[0] !== "object" || rule[0] === null) {
    throw new Error(
      "declaration-property-value-disallowed-list rule is missing or not shaped as [keys, options]",
    );
  }
  return Object.keys(rule[0] as Record<string, unknown>);
}

it("간격과 모서리 양쪽에 리터럴 px 금지가 걸려 있다", async () => {
  const keys = await disallowedListPropertyKeys();
  expect(
    keys.some(
      (key) =>
        key.includes("padding") &&
        key.includes("margin") &&
        key.includes("gap"),
    ),
  ).toBe(true);
  expect(keys.some((key) => key.includes("radius"))).toBe(true);
});

// 이유 없는 무력화를 막는다 — `--` 뒤에 설명이 있어야 stylelint 가 이유로 읽는다.
it("규칙을 끄는 주석에는 전부 이유가 붙어 있다", () => {
  const offenders: string[] = [];
  const files = cssFiles();
  // 비공허성 1: `cssFiles()` 가 필터를 잘못 걸어(혹은 리팩터가 경로를 바꿔) 빈
  // 목록을 돌려줘도 아래 루프는 그냥 통과한다 — 파일 수가 오늘의 68 아래로
  // 무너지면 여기서 먼저 걸린다(실측: `find src/styles -name "*.css" -not
  // -path "*/generated/*" | wc -l` → 68).
  expect(files.length).toBeGreaterThanOrEqual(68);
  let disableCount = 0;
  // ‼️ `cssRules()` 를 쓰지 않는다 — 그 함수는 파싱 전에 주석을 지운다
  // (`css-rules.ts` 의 `cssRules` 안 `.replace(/\/\*[\s\S]*?\*\//gu, "")`).
  // 주석을 찾는 검사가 주석 없는 입력을 받으면 늘 빈 배열을 보고 통과한다.
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/stylelint-disable[^\n]*/gu)) {
      disableCount++;
      if (!/--\s+\S/u.test(m[0]!)) offenders.push(`${file}: ${m[0]!}`);
    }
  }
  // 비공허성 2: `offenders` 는 `disableCount` 가 0 이어도(스캔이 아무 disable
  // 주석도 찾지 못해도) 빈 배열이라 통과한다 — 스캔이 실제로 뭔가 찾았는지
  // 세어야 그 무증상을 관측한다. 오늘의 disable 주석은 정확히 10개다(Task 4
  // 개정 2 의 9건 + 개정 5 의 links.css 1건).
  expect(disableCount).toBe(10);
  expect(offenders).toEqual([]);
});
