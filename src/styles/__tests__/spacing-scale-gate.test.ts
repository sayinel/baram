// 규칙이 조용히 느슨해지는 것을 막는다. stylelint 설정은 주석 한 줄로 무력화되고
// (`"declaration-property-value-disallowed-list": null`) 그러면 CI 는 계속 초록이다.
//
// 무엇이 이것을 실패시키는가: 규칙을 지우거나, 간격·모서리 중 한쪽만 남기거나,
// 값 정규식이 리터럴 px 를 못 잡거나 `0`·백분율·`em` 을 잡게 바뀌거나, 모서리 키가
// `border-radius` 를 빠뜨리거나 `--radius-*` 토큰 정의까지 덮게 바뀌거나, disable 주석이
// 이유 없이 붙으면 실패한다.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import stylelint from "stylelint";
import { expect, it } from "vitest";

import { cssFiles } from "./css-rules";

const RULE = "declaration-property-value-disallowed-list";

/**
 * `declaration-property-value-disallowed-list` 규칙의 property 키 목록을,
 * 파일을 **평가**해서 얻는다 — 텍스트로 읽지 않는다.
 *
 * ‼️ 왜 텍스트 매치(`toMatch(/radius/u)`)가 아닌가: 리뷰가 radius 키를 지우고
 * 돌려 봤더니 이 테스트가 그대로 초록이었다. 규칙 바로 위 `‼️` 주석과 규칙의
 * `message`(`--space-*` 와 `--radius-*` 를 함께 부르는 한 줄) 양쪽 모두에 "radius" 라는 글자가
 * 남아 있어서, 파일 **텍스트** 안 어딘가에 그 단어가 있는지만 보는 검사는
 * 키가 사라져도 계속 통과했다. 주석을 지워도 `message` 가 남아 같은 문제가
 * 재현된다 — 텍스트 매치 자체가 잘못된 도구였다. 규칙 객체의 키를 직접 읽으면
 * 키를 지우는 순간만 빨갛다.
 */
async function disallowedListPropertyKeys(): Promise<string[]> {
  const rule = (await repoConfig()).rules?.[RULE];
  if (!Array.isArray(rule) || typeof rule[0] !== "object" || rule[0] === null) {
    throw new Error(
      "declaration-property-value-disallowed-list rule is missing or not shaped as [keys, options]",
    );
  }
  return Object.keys(rule[0] as Record<string, unknown>);
}

/**
 * `code` 를 이 리포의 stylelint 설정 **그대로** 린트해, 이 규칙이 낸 경고만 센다.
 *
 * 규칙 이름으로 거르는 이유: 설정이 확장하는 규칙도 한 줄짜리 픽스처에 경고를 낸다
 * (실측: `declaration-block-single-line-max-declarations` · `order/properties-order`).
 * 그것까지 세면 개수가 이 규칙이 아니라 서식 규칙을 따라 움직인다.
 */
async function disallowedListWarnings(code: string): Promise<number> {
  const { results } = await stylelint.lint({
    code,
    config: await repoConfig(),
    configBasedir: process.cwd(),
  });
  return results
    .flatMap((result) => result.warnings)
    .filter((warning) => warning.rule === RULE).length;
}

/**
 * `stylelint.config.mjs` 가 export 하는 설정 객체 — `npm run lint:css` 가 읽는 바로 그것.
 *
 * `import(...)` 을 정적 문자열이 아니라 변수로 호출하는 것은 우연이 아니다 —
 * 이 프로젝트는 `allowJs` 가 꺼져 있어 `.mjs` 파일을 정적 import 하면
 * `npm run typecheck` 가 선언 파일을 찾지 못해 멎는다. 변수 경로를 쓰면
 * TypeScript 가 모듈을 정적으로 해석하지 않고 반환 타입을 `any` 로 취급해
 * 타입체크를 통과한다(실측: `tsc -p tsconfig.test.json --noEmit` exit 0).
 */
async function repoConfig(): Promise<stylelint.Config> {
  const configPath = resolve(process.cwd(), "stylelint.config.mjs");
  const configUrl = pathToFileURL(configPath).href;
  const mod = await import(configUrl);
  return mod.default;
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

// 위 검사는 규칙이 **있는지**만 본다 — 값 정규식을 읽지 않으므로, 값이 `/rem/` 처럼
// 리터럴 px 를 못 잡는 정규식으로 바뀌어도 초록이다. 아래 셋은 규칙을 실제 설정으로
// **돌려서** 무엇을 잡고 무엇을 두는지 고정한다.

// 무엇이 이것을 실패시키는가: 값 정규식이 `10px` 을 못 잡게 바뀌거나(`/rem/`), 모서리
// 키가 `border-radius` 를 빠뜨리게 좁혀지면(`border-top-left-radius` 만) 2 아래로 떨어진다.
// 아래 두 0건 단언의 긍정 짝이다 — 이것이 초록이어야 0건이 "규칙이 죽어서" 가 아니라
// "그 값을 허용해서" 로 읽힌다.
it("관문이 간격과 모서리의 리터럴 px 를 하나씩 잡는다", async () => {
  expect(
    await disallowedListWarnings(".a{padding:10px;border-radius:10px}"),
  ).toBe(2);
});

// R-C 가 리터럴로 남긴 값 — `0`, 원(`50%`), 타이포 축(`em`). 무엇이 이것을 실패시키는가:
// 값 정규식이 넓어져(숫자면 무엇이든 잡는 `/\d/u`) 이 셋 중 하나라도 잡으면 실패한다.
it("R-C 가 남긴 0 · 백분율 · em 은 통과한다", async () => {
  expect(
    await disallowedListWarnings(
      ".a{padding:0;border-radius:50%;margin:0.2em}",
    ),
  ).toBe(0);
});

// `lint:css` 는 `src/**/*.css` 라 `generated/primitives.css` 의 토큰 정의도 읽는다 — 그
// 정의가 관문에 걸리면 안 된다. 무엇이 이것을 실패시키는가: 모서리 키를 앵커 없는
// `/radius/` 로 넓히면 `--radius-sm` 이 거기 맞아 1건이 된다.
it("토큰 정의(--radius-sm: 2px)는 관문에 걸리지 않는다", async () => {
  expect(await disallowedListWarnings(":root{--radius-sm:2px}")).toBe(0);
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
  // 세어야 그 무증상을 관측한다. 오늘의 disable 주석은 정확히 12개다 — R-C 가 리터럴로
  // 남긴 11건(음수 10 · `calc()` 안 1)과, jsdom 계산값 단언 때문에 리터럴로 남긴
  // `links.css` `.block-reference` 1건.
  expect(disableCount).toBe(12);
  expect(offenders).toEqual([]);
});
