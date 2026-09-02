// 이슈 515의 수용 기준 핀 — "주석 속 `--x:`는 정의로 세지 않는다"를 픽스처로
// 고정한다. 이 핀이 생기기 전에는 게이트 스크립트만 존재했고, 죽은 사용처를
// 전부 고친 순간 게이트는 아무것도 지키지 않았다(stripCssComments를 통째로
// 되돌려도 CI 초록불 — 적대 리뷰 실측). 이 파일이 그 되돌림을 빨간불로 만든다.
import { describe, expect, it } from "vitest";

import {
  collectCssDefinitions,
  collectVarUses,
  stripCssComments,
  stripTsComments,
} from "../css-var-scan";

describe("collectCssDefinitions — 주석은 정의가 아니다", () => {
  it("생성 CSS의 '(was --old-name: #hex)' 주석을 정의로 세지 않는다", () => {
    // 이슈 515를 만든 실제 형태 그대로의 픽스처.
    const css = `
      :root {
        --color-bg-subtle: #f8f9fa; /** Secondary background (was --color-bg-secondary: #f8f9fa) */
      }`;
    const defined = collectCssDefinitions(css);
    expect(defined.has("--color-bg-subtle")).toBe(true);
    expect(defined.has("--color-bg-secondary")).toBe(false);
  });

  it("여러 줄 블록 주석 속 정의도 세지 않는다", () => {
    const css = `
      /* 과거 팔레트:
         --color-ghost: #123456;
         --color-phantom: #654321; */
      .x { --color-real: #fff; }`;
    const defined = collectCssDefinitions(css);
    expect(defined).toEqual(new Set(["--color-real"]));
  });
});

describe("collectVarUses — 주석 속 var()는 사용이 아니다", () => {
  it("CSS 주석 속 var()를 사용으로 세지 않는다", () => {
    const css = `
      /* 예전에는 var(--color-old)를 썼다 */
      .x { color: var(--color-live); }`;
    expect(collectVarUses(css, "css")).toEqual(new Set(["--color-live"]));
  });

  it("TS 줄 머리 주석 속 var() 예시를 사용으로 세지 않는다", () => {
    // svg-utils의 실제 오탐 사례 형태.
    const ts = `
      // fill을 var(--color-doc-example)로 바꾸는 예시
      const style = "color: var(--color-live)";`;
    expect(collectVarUses(ts, "ts")).toEqual(new Set(["--color-live"]));
  });
});

describe("stripTsComments — 트레일링 주석은 남긴다", () => {
  it("문자열 속 URL을 주석으로 오인해 코드를 자르지 않는다", () => {
    const ts = `const url = "https://example.com/path"; // trailing note`;
    expect(stripTsComments(ts)).toContain("https://example.com/path");
  });
});

describe("stripCssComments", () => {
  it("주석만 제거하고 선언은 보존한다", () => {
    const css = `/* a */ .x { --k: v; } /* b */`;
    expect(stripCssComments(css).trim()).toBe(".x { --k: v; }");
  });
});
