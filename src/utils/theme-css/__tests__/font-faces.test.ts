// §351 · 스펙 0060 §7.2 — 테마 CSS 가 `@font-face` 로 선언한 패밀리.
import { describe, expect, it } from "vitest";

import { fontFaceFamilies } from "../font-faces";

describe("fontFaceFamilies", () => {
  it("따옴표를 벗긴 패밀리 이름", () => {
    expect(
      fontFaceFamilies(
        '@font-face{font-family:"Theme Serif";src:url(data:font/woff2;base64,AA==)}',
      ),
    ).toEqual(["Theme Serif"]);
  });

  it("따옴표 없는 이름도 읽는다", () => {
    expect(
      fontFaceFamilies("@font-face{font-family:Theme Sans;src:local(x)}"),
    ).toEqual(["Theme Sans"]);
  });

  // 테마 CSS 는 `@layer baram-theme` 안에 놓일 수 있다 — 중첩 블록 안의 `@font-face` 도 센다.
  it("@layer · @media 안의 @font-face", () => {
    expect(
      fontFaceFamilies(
        "@layer baram-theme{@font-face{font-family:'A'}}@media screen{@font-face{font-family:'B'}}",
      ),
    ).toEqual(["A", "B"]);
  });

  // 무엇이 이것을 실패시키는가: `@font-face` 밖의 `font-family` 선언까지 세면, 테마가 본문에 적은
  // 시스템 서체 이름이 "테마 제공" 으로 거짓 표시된다.
  it("@font-face 밖의 font-family 는 세지 않는다", () => {
    expect(fontFaceFamilies(".x{font-family:'Not A Face'}")).toEqual([]);
  });

  it("CSS 가 없으면 빈 배열", () => {
    expect(fontFaceFamilies("")).toEqual([]);
  });

  // `verify.ts`(§358) 는 css-tree 3.2.1 이 CSS 중첩 규칙 일부를 `Raw` 로 남겨 그 안의 선언이
  // 워크에 닿지 않는 것을 실측한 적이 있다 — 여기서도 같은 위험을 확인한다: `@supports` ·
  // `@container` 프렐류드 안이 아니라 그 **본문**에 놓인 `@font-face` 는 정상적인 at-rule
  // 블록이라 `Raw` 로 남지 않고 워크에 닿는다(이 테스트가 실측).
  it("@supports · @container 안의 @font-face", () => {
    expect(
      fontFaceFamilies(
        "@supports (display:grid){@font-face{font-family:'S'}}@container (min-width:1px){@font-face{font-family:'C'}}",
      ),
    ).toEqual(["S", "C"]);
  });
});
