// §351 · 스펙 0060 §7.2 — 테마 CSS 가 `@font-face` 로 선언한 패밀리.
import * as csstree from "css-tree";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fontFaceFamilies } from "../font-faces";

// 파서를 감싸 호출 수를 센다 — 같은 원문을 다시 파싱하지 않는지는 결과가 같다는 것만으로는 보이지
// 않는다(메모가 없어도 결과는 같다).
vi.mock("css-tree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("css-tree")>();
  return { ...actual, parse: vi.fn(actual.parse) };
});

const parse = vi.mocked(csstree.parse);

/** 이 파일의 다른 테스트가 메모에 남긴 원문과 겹치지 않는 CSS. */
function faceCss(family: string): string {
  return `@font-face{font-family:"${family}";src:local(memo-probe-${family})}`;
}

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

// 무엇이 이것을 실패시키는가: 메모가 없으면 이 함수를 부르는 훅의 인스턴스 · 마운트마다 테마 CSS
// 전체(인라인 서체로 수 MB)를 다시 파싱한다.
describe("fontFaceFamilies 메모", () => {
  beforeEach(() => {
    parse.mockClear();
  });

  it("같은 원문은 다시 파싱하지 않고, 다른 원문은 파싱한다", () => {
    const css = faceCss("Same");
    expect(fontFaceFamilies(css)).toEqual(["Same"]);
    expect(fontFaceFamilies(css)).toEqual(["Same"]);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(fontFaceFamilies(faceCss("Other"))).toEqual(["Other"]);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  // 무엇이 이것을 실패시키는가: 묶지 않으면 갈아입은 옛 테마의 CSS 가 세션 내내 남고, 쓸 때 순서를
  // 갱신하지 않으면 계속 쓰는 현재 테마의 CSS 가 먼저 밀려난다.
  it("넷을 넘으면 가장 오래 쓰지 않은 것부터 잊는다", () => {
    const [a, b, c, d, e] = ["A", "B", "C", "D", "E"].map((n) =>
      faceCss(`Lru${n}`),
    );
    for (const css of [a, b, c, d]) fontFaceFamilies(css);
    expect(parse).toHaveBeenCalledTimes(4);
    fontFaceFamilies(a); // a 를 가장 최근으로 — 이제 가장 오래 쓰지 않은 것은 b 다.
    fontFaceFamilies(e); // 다섯째 — b 를 잊는다.
    expect(parse).toHaveBeenCalledTimes(5);
    fontFaceFamilies(a);
    expect(parse).toHaveBeenCalledTimes(5);
    fontFaceFamilies(b);
    expect(parse).toHaveBeenCalledTimes(6);
  });

  // 무엇이 이것을 실패시키는가: 캐시와 같은 배열을 그대로 내주면 부르는 쪽의 수정이 다음 호출의 답이
  // 된다. 짝: 얼린 배열도 같은 이름을 담는다.
  it("돌려준 배열은 고칠 수 없고, 다음 호출의 답은 그대로다", () => {
    const css = faceCss("Frozen");
    const first = fontFaceFamilies(css);
    expect(first).toEqual(["Frozen"]);
    expect(() => (first as string[]).push("Injected")).toThrow(TypeError);
    expect(fontFaceFamilies(css)).toEqual(["Frozen"]);
  });
});
