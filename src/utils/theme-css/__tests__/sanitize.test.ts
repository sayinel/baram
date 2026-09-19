// §358 테마 CSS 위생 — 판정은 전부 파서가 한다. 문자열 검사는 우회당한다.
import { describe, expect, it } from "vitest";

import { ThemeCssError } from "../errors";
import { sanitizeThemeCss } from "../sanitize";

function code(css: string): string {
  try {
    sanitizeThemeCss(css);
    return "(통과)";
  } catch (e) {
    return e instanceof ThemeCssError ? e.code : "(다른 예외)";
  }
}

describe("절대 URL 거부", () => {
  it.each([
    ["a{background:url(https://e.com/x.png)}", "https"],
    ["a{background:url(http://e.com/x.png)}", "http"],
    ["a{background:url(//e.com/x.png)}", "프로토콜 상대"],
    ['a{background:url("https://e.com/x.png")}', "따옴표"],
    ["a{background:url('https://e.com/x.png')}", "홑따옴표"],
    ["a{background:image-set(url(https://e.com/x.png) 1x)}", "image-set"],
    ["a{background:url(HTTPS://E.COM/x.png)}", "대문자"],
    ["a{background:url(\\68 ttps://e.com/x.png)}", "CSS 이스케이프"],
    ["a{background:url(  https://e.com/x.png  )}", "공백 패딩"],
  ])("%s → absoluteUrl (%s)", (css) => {
    expect(code(css)).toBe("absoluteUrl");
  });

  it("상대 경로는 통과한다", () => {
    expect(code("a{background:url(assets/x.png)}")).toBe("(통과)");
  });
});

// 아래 넷은 계획의 표에 없다. 실측으로 발견한 구멍이라 못으로 박아 둔다 —
// 앞의 표만 통과하는 구현은 문 하나만 잠근 것이다.
describe("절대 URL 거부 — 표에 없던 입구", () => {
  it("커스텀 속성 값도 본다 — css-tree 기본값은 이 값을 Raw 로 통째로 삼킨다", () => {
    expect(code(":root{--evil:url(https://e.com/x.png)}")).toBe("absoluteUrl");
  });

  it("image-set 의 <string> 인자도 URL 이다 — Url 노드가 아니다", () => {
    expect(code('a{background:image-set("https://e.com/x.png" 1x)}')).toBe(
      "absoluteUrl",
    );
  });

  it("scheme 안의 탭은 URL 파서가 지운다 — scheme regex 는 못 본다", () => {
    expect(code('a{background:url("htt\tps://e.com/x.png")}')).toBe(
      "absoluteUrl",
    );
  });

  it("scheme 이 붙은 것은 전부 거부한다 — data: 도 포함(보수적인 쪽)", () => {
    expect(code("a{background:url(data:image/gif;base64,R0lGOD)}")).toBe(
      "absoluteUrl",
    );
  });
});

describe("상대 참조는 통과한다", () => {
  it.each([
    "a{background:url(assets/x.png)}",
    "a{background:url(../up.png)}",
    "a{filter:url(#f)}",
    "a{background:url()}",
    'a{content:"https://e.com/x.png"}',
  ])("%s", (css) => {
    expect(code(css)).toBe("(통과)");
  });
});

describe("@import 거부", () => {
  it.each([
    "@import url(https://e.com/t.css);",
    '@import "local.css";',
    "@import url(local.css) screen;",
  ])("%s → importNotAllowed", (css) => {
    expect(code(css)).toBe("importNotAllowed");
  });
});

describe("!important 제거", () => {
  it("선언에서 사라진다", () => {
    const out = sanitizeThemeCss("a{color:red !important}");
    expect(out).not.toMatch(/!\s*important/i);
    expect(out).toMatch(/color:\s*red/);
  });

  it("대소문자·공백을 섞어도 사라진다", () => {
    expect(sanitizeThemeCss("a{color:red !  IMPORTANT}")).not.toMatch(
      /important/i,
    );
  });
});

describe("@layer 래핑", () => {
  it("전체가 baram-theme 레이어 안에 들어간다", () => {
    const out = sanitizeThemeCss("a{color:red}");
    expect(out.trimStart().startsWith("@layer baram-theme")).toBe(true);
    expect(out).toMatch(/a\s*\{/);
  });

  it("테마가 스스로 레이어를 선언해도 우리 레이어 안에 중첩된다", () => {
    const out = sanitizeThemeCss("@layer evil{a{color:red}}");
    expect(out.indexOf("@layer baram-theme")).toBe(0);
  });
});

describe("파싱 실패는 닫는다", () => {
  it("망가진 CSS는 parseFailed 로 거부한다 — 통과시키지 않는다", () => {
    expect(code("a{color:red")).not.toBe("(통과)");
  });

  // css-tree 의 기본 파서는 관대하다: `a{color:red` 를 조용히 닫고 성공을 돌려준다.
  // onParseError 도 부르지 않는다(실측). 아래가 그 관대함의 실제 범위다.
  it.each([
    ["a{color:red", "블록 미닫힘"],
    ["@media screen{a{color:red}", "중첩 블록 미닫힘"],
    ['a{content:"hi}', "문자열 미닫힘"],
    ["a{background:url(x.png}", "url() 미닫힘"],
    ["}}}{{{", "짝 없는 괄호"],
    ['a{font-family:"Foo\nBar"}', "문자열 안 개행"],
  ])("%s → parseFailed (%s)", (css) => {
    expect(code(css)).toBe("parseFailed");
  });

  it("세미콜론·주석만 남은 Raw 는 찌꺼기라 통과시킨다", () => {
    expect(code("a{;;color:red}")).toBe("(통과)");
    expect(code("a{/* c */color:red}")).toBe("(통과)");
  });

  // 여기 URL 은 Url 노드가 아니라 Raw 안에 통째로 들어간다 — Url 워크가 보지 못한다.
  // 오늘은 onParseError 가 먼저 잡고 Raw 관문이 두 번째 자물쇠다. 둘 중 하나만 남아도
  // 거부여야 하므로 결과로만 못을 박는다.
  it("워크가 못 본 CSS 는 검사되지 않은 CSS 다 — Raw 에 숨은 URL 도 거부한다", () => {
    expect(code("@layer url(https://e.com/x.png);")).toBe("parseFailed");
    expect(code("@page url(https://e.com/x.png){margin:0}")).toBe(
      "parseFailed",
    );
  });
});

describe("정상 CSS 는 살아서 나온다", () => {
  it("현대 문법을 깨뜨리지 않는다", () => {
    const css = [
      "@media (min-width:400px){a:has(>img){color:red}}",
      "@supports selector(:has(a)){a{color:blue}}",
      "@keyframes x{from{opacity:0}to{opacity:1}}",
      "@font-face{font-family:X;src:url(f.woff2) format('woff2')}",
      ":root{--gap:4px;--bg:url(bg.png)}",
      "a{color:color-mix(in oklab,red 50%,blue);&:hover{color:blue}}",
    ].join("");
    const out = sanitizeThemeCss(css);
    expect(out).toContain("color-mix(in oklab");
    expect(out).toContain("url(f.woff2)");
    expect(out).toContain("--bg:url(bg.png)");
  });
});

describe("ThemeCssError", () => {
  it("코드를 들고 다니고 상세는 로그용으로만 붙는다", () => {
    try {
      sanitizeThemeCss("a{background:url(https://e.com/x.png)}");
      throw new Error("거부했어야 한다");
    } catch (e) {
      expect(e).toBeInstanceOf(ThemeCssError);
      const err = e as ThemeCssError;
      expect(err.code).toBe("absoluteUrl");
      expect(err.name).toBe("ThemeCssError");
      expect(err.detail).toContain("https://e.com/x.png");
    }
  });
});
