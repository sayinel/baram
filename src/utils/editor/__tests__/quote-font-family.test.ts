// src/utils/editor/__tests__/quote-font-family.test.ts
// §349 — 사용자 서체 이름을 CSS 값으로 안전하게 만든다.
//
// §346의 결함 5: `use-settings-effects.ts`가 `${fontFamily}, var(...)`를 그대로
// 대입했다. CSS의 unquoted <family-name>은 <custom-ident> 열이고 custom-ident는
// 숫자로 시작할 수 없다 — 목록에 실제로 있던 "Source Sans 3"이 그 경우다.
//
// ‼️ 문자열 모양만 비교하지 않는다. 마지막 describe가 결과를 실제
// CSSStyleDeclaration에 대입해 값이 남는지 본다 — 브라우저가 거부하는 것은
// 문자열 비교로 볼 수 없다.
import { describe, expect, it } from "vitest";

import { quoteFamily } from "../quote-font-family";

describe("quoteFamily", () => {
  it("quotes a plain family name", () => {
    expect(quoteFamily("Inter")).toBe('"Inter"');
  });

  it("quotes a name containing spaces", () => {
    expect(quoteFamily("Noto Sans KR")).toBe('"Noto Sans KR"');
  });

  // 이 케이스가 결함 5 그 자체다.
  it("quotes a name whose token starts with a digit", () => {
    expect(quoteFamily("Source Sans 3")).toBe('"Source Sans 3"');
  });

  it("escapes an embedded double quote", () => {
    expect(quoteFamily('Ba"ram')).toBe('"Ba\\"ram"');
  });

  it("escapes an embedded backslash", () => {
    expect(quoteFamily("Ba\\ram")).toBe('"Ba\\\\ram"');
  });

  // 콤마가 든 이름을 인용하지 않으면 두 패밀리로 읽힌다.
  it("keeps a comma inside the quoted name", () => {
    expect(quoteFamily("Foo, Bar")).toBe('"Foo, Bar"');
  });

  // 제네릭 키워드는 인용하면 무효해진다 — 열거된 예외.
  it.each([
    "serif",
    "sans-serif",
    "monospace",
    "system-ui",
    "cursive",
    "ui-monospace",
  ])("leaves the generic keyword %s unquoted", (generic) => {
    expect(quoteFamily(generic)).toBe(generic);
  });

  it("treats a generic keyword case-insensitively", () => {
    expect(quoteFamily("Serif")).toBe("Serif");
  });

  it("returns an empty string unchanged so callers can fall through to the stack", () => {
    expect(quoteFamily("")).toBe("");
    expect(quoteFamily("   ")).toBe("");
  });

  describe("the browser accepts what we produce", () => {
    const assign = (value: string): string => {
      const el = document.createElement("div");
      el.style.fontFamily = value;
      return el.style.fontFamily;
    };

    it.each(["Inter", "Noto Sans KR", "Source Sans 3", "Foo, Bar"])(
      "keeps a value built from %s",
      (name) => {
        const value = `${quoteFamily(name)}, sans-serif`;
        expect(assign(value), `engine rejected ${value}`).not.toBe("");
      },
    );

    // 반증: 인용하지 않으면 엔진이 거부하거나 다르게 읽는다. 이 단정이
    // 실패하면 quoteFamily 는 아무것도 막고 있지 않다는 뜻이다.
    it("shows that the unquoted digit-leading name is not equivalent", () => {
      const quoted = assign(`${quoteFamily("Source Sans 3")}, sans-serif`);
      const bare = assign("Source Sans 3, sans-serif");
      expect(quoted).not.toBe(bare);
    });
  });
});
