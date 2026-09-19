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

// 거부한 관문을 이름으로 구분하기 위한 것. `assertNoRemoteReferences` 만 detail 을
// `output ` 으로 시작한다 — 그 관문을 단독으로 고정하는 테스트가 이걸 쓴다.
function detail(css: string): string {
  try {
    sanitizeThemeCss(css);
    return "(통과)";
  } catch (e) {
    return e instanceof ThemeCssError ? (e.detail ?? "") : "(다른 예외)";
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

// 리뷰 1차가 실측으로 잡아낸 우회. 판정 base 와 scheme 이 같으면 WHATWG 파서는
// `https:evil.com/x` 를 상대 참조로 읽는다 — 그런데 앱의 실제 base 는 `tauri:`·`http:`
// 라 브라우저는 같은 값을 `https://evil.com/x` 로 읽고 CSP `img-src … https:` 가 허용한다.
describe("절대 URL 거부 — scheme 상대(authority 생략) 형태", () => {
  it.each([
    ["a{background:url(https:evil.com/x.png)}", "슬래시 없음"],
    ["a{background:url(https:/evil.com/x.png)}", "슬래시 하나"],
    ["a{background:url(\\68 ttps:evil.com/x.png)}", "이스케이프 + 슬래시 없음"],
    ["@font-face{src:url(https:evil.com/f.woff)}", "@font-face 안"],
    ["@font-face{src:url(https:/evil.com/f.woff)}", "@font-face + 슬래시 하나"],
    [
      "@font-face{src:url(\\68 ttps:evil.com/f.woff)}",
      "@font-face + 이스케이프",
    ],
    ["a{background:url(http:evil.com/x.png)}", "판정 base 와 다른 scheme"],
    ["a{background:url(HTTPS:EVIL.COM/x.png)}", "대문자"],
  ])("%s → absoluteUrl (%s)", (css) => {
    expect(code(css)).toBe("absoluteUrl");
  });

  // special scheme(앱의 실제 base 인 `http:`) 에서만 백슬래시가 authority 구분자로
  // 바뀐다. 불투명 scheme 쌍만 썼다면 이쪽이 상대 경로로 보였을 것이다 — 두 쌍이
  // 서로를 받쳐 준다. CSS 원문에서 `\\` 는 백슬래시 **하나**이므로 String.raw 로 쓴다.
  it.each([
    [
      String.raw`a{background:url("\\\\evil.com\\x.png")}`,
      String.raw`\\evil.com\x.png`,
    ],
    [
      String.raw`a{background:url("/\\evil.com/x.png")}`,
      String.raw`/\evil.com/x.png`,
    ],
    [String.raw`a{background:url(\\\\evil.com\\x.png)}`, "따옴표 없는 같은 값"],
  ])("%s → absoluteUrl (백슬래시 authority: %s)", (css) => {
    expect(code(css)).toBe("absoluteUrl");
  });

  // 백슬래시 **하나**는 authority 를 만들지 못한다 — `http://tauri.localhost/evil.com/…`
  // 로 풀리므로 루트 절대 경로와 같은 부류다(우리 정책상 통과).
  it("백슬래시 하나는 같은 origin 이라 통과한다", () => {
    expect(code(String.raw`a{background:url("\evil.com/x.png")}`)).toBe(
      "(통과)",
    );
  });
});

// `var()` 는 computed-value 시점에 풀린다 — 설치 시점에 값을 증명할 수 없다.
// 좁은 규칙을 골랐다: 자원 이름을 받는 함수 안의 치환 함수만 거부한다. 그래서
// `content:"https://…"` 같은 평범한 텍스트는 계속 합법이다(위 "상대 참조" 그룹이 고정).
//
// ‼️ 코드는 `absoluteUrl` 이 **아니다**. `--x` 가 순전히 로컬이어도 거부하므로 그 코드는
// 제작자에게 거짓 원인을 보여 준다 — 아래 두 줄이 그 구분을 못으로 박는다.
describe("자원 이름을 받는 함수 안의 치환 함수 거부", () => {
  it.each([
    ':root{--x:"https://evil.com/x.png"}a{background:image-set(var(--x) 1x)}',
    "a{background:image-set(var(--x) 1x)}",
    'a{background:image-set(var(--x,"https://evil.com/x.png") 1x)}',
    "a{background:-webkit-image-set(var(--x) 1x)}",
    "a{background:image(var(--x))}",
    "a{background:image-set(env(--x) 1x)}",
  ])("%s → substitutionNotAllowed", (css) => {
    expect(code(css)).toBe("substitutionNotAllowed");
  });

  it("치환이 로컬이어도 거부는 치환을 이유로 한다", () => {
    expect(
      code(':root{--x:"local.png"}a{background:image-set(var(--x) 1x)}'),
    ).toBe("substitutionNotAllowed");
  });

  it("커스텀 속성이 image-set 통째를 들고 있어도 본다", () => {
    expect(
      code(
        ':root{--w:image-set("https://evil.com/x.png" 1x)}a{background:var(--w)}',
      ),
    ).toBe("absoluteUrl");
  });

  // 따옴표 없는 `url()` 안에 `(` 가 들어가면 토크나이저가 bad-url-token 을 낸다.
  // 치환 함수 규칙까지 가지 않고 더 앞에서 닫히지만, 어느 쪽이든 통과는 아니다.
  it("url(var(--x)) 는 토크나이저 단계에서 닫힌다", () => {
    expect(code("@media (scripting:url(var(--x))){a{color:red}}")).toBe(
      "parseFailed",
    );
  });

  it("자원 이름을 받는 함수 밖의 var() 는 건드리지 않는다", () => {
    expect(code("a{color:var(--c);background:url(a.png)}")).toBe("(통과)");
  });
});

// `image()` 는 `<image-src> = <url> | <string>` 이라 맨 문자열이 이미지 출처다.
// 오늘 구현한 브라우저는 없지만 구멍의 모양이 `image-set()` 과 같다.
describe("image()·src() 의 <string> 인자", () => {
  it.each([
    'a{background:image("https://evil.com/x.png")}',
    'a{background:src("https://evil.com/x.png")}',
  ])("%s → absoluteUrl", (css) => {
    expect(code(css)).toBe("absoluteUrl");
  });

  it("상대 경로는 통과한다", () => {
    expect(code('a{background:image("x.png")}')).toBe("(통과)");
  });
});

// 값 자리 **밖**에서는 css-tree 가 `url("…")` 를 `Url` 이 아니라 `Function:url` 로 준다.
// 노드 모양을 열거하는 워크는 그래서 한 번 새어 나갔다 — 나가는 바이트를 토큰으로 다시
// 훑는 관문이 그 부류를 통째로 닫는다.
// ‼️ 아래 그룹이 `assertNoRemoteReferences` 를 **단독으로** 고정한다. 여기 문자열들은
// 자원 이름을 받는 함수 **안쪽**에 있지만 바로 위 함수는 그렇지 않아서, `this.function`
// 하나만 보는 AST 워크에는 보이지 않는다. 그래서 detail 이 `output ` 으로 시작한다 —
// 출력 스캔이 잡았다는 뜻이고, 그 관문을 지우면 이 그룹만 빨개진다(실측: 이 관문을
// 빼면 말뭉치 539개 중 33개가 열린다).
describe("출력 스캔만이 잡는 것", () => {
  it.each([
    'a{background:image-set(local("https://evil.com/x.png") 1x)}',
    'a{background:src(format("https://evil.com/x.png"))}',
    'a{background:image-set(foo("https://evil.com/x.png") 1x)}',
    'a{background:image(rect("https://evil.com/x.png"))}',
    'a{background:image-set(url(a.png) type("https://evil.com/x.png"))}',
  ])("%s → absoluteUrl, 그리고 잡은 곳은 출력 스캔이다", (css) => {
    expect(code(css)).toBe("absoluteUrl");
    expect(detail(css).startsWith("output ")).toBe(true);
  });

  it("같은 모양의 상대 경로는 통과한다", () => {
    expect(code('a{background:image-set(local("x.png") 1x)}')).toBe("(통과)");
  });
});

// ‼️ 이 그룹이 워크의 `Url` case 와 `String` case 를 단독으로 고정한다 — 다만 고정하는 것은
// **보안 판정이 아니라 진단**이다. 두 case 를 지워도 `assertNoRemoteReferences` 가 같은 입력을
// 같은 code 로 거부하므로 통과 여부는 바뀌지 않는다(실측: 말뭉치 539개의 판정이 무변화).
// 바뀌는 것은 detail 이다 — 워크가 먼저 답하면 `(줄:칸)` 이 붙고, 지우면 위치 없는
// `output …` 만 남아 테마 작성자가 어디를 고쳐야 할지 알 수 없다. 그 차이를 고정한다.
describe("워크가 먼저 답하고 위치를 준다", () => {
  it.each([
    "a{background:url(https://e.com/x.png)}",
    "@media print{a{background:url(https://e.com/x.png)}}",
  ])("%s — Url case 가 위치와 함께 거부한다", (css) => {
    expect(code(css)).toBe("absoluteUrl");
    expect(detail(css)).toMatch(/\(\d+:\d+\)$/);
  });

  it("image-set 의 문자열은 String case 가 위치와 함께 거부한다", () => {
    const css = 'a{background:image-set("https://e.com/x.png" 1x)}';
    expect(code(css)).toBe("absoluteUrl");
    expect(detail(css)).toMatch(/\(\d+:\d+\)$/);
  });
});

describe("나가는 CSS 를 토큰으로 다시 훑는다", () => {
  it.each([
    'a{background:image-set("https://evil.com/x.png" 1x)}',
    '@media (scripting:url("https://evil.com/x.png")){a{color:red}}',
    '@media (scripting:url("htt\tps://evil.com/x.png")){a{color:red}}',
    '@supports (background:url("https://evil.com/x.png")){a{color:red}}',
  ])("%s → absoluteUrl", (css) => {
    expect(code(css)).toBe("absoluteUrl");
  });

  it("같은 자리의 상대 경로는 통과한다", () => {
    expect(code('@media (scripting:url("x.png")){a{color:red}}')).toBe(
      "(통과)",
    );
  });

  it("나가는 CSS 안에는 원격 참조가 한 건도 없다", () => {
    const out = sanitizeThemeCss(
      ':root{--bg:url(bg.png)}a{background:image-set("a.png" 1x,"b.png" 2x)}',
    );
    expect(out).toContain("url(bg.png)");
    expect(out).not.toMatch(/https?:/);
  });
});

// ‼️ 이름 비교는 반드시 디코드한 뒤에 한다. css-tree 는 at-rule·함수 이름을 원문 그대로
// 주므로, 이 관문들이 한때 `@\69 mport "local.css"` 와 `\69 mage-set("https://…")` 를
// 통째로 지나보냈다(실측). `\68 ttps:` 와 같은 부류다.
describe("이스케이프한 이름도 같은 이름이다", () => {
  it.each([
    ["@\\69 mport url(https://e.com/t.css);", "importNotAllowed"],
    ['@\\69 mport "local.css";', "importNotAllowed"],
    ['@\\69 mport "https://evil.com/t.css";', "importNotAllowed"],
    ["@\\49 MPORT url(https://e.com/t.css);", "importNotAllowed"],
    ['a{background:\\75 rl("https://evil.com/pixel.png")}', "absoluteUrl"],
    ['a{background:u\\72 l("https://evil.com/pixel.png")}', "absoluteUrl"],
    ['a{background:\\69 mage-set("https://e.com/x.png" 1x)}', "absoluteUrl"],
    ['a{background:i\\6d age-set("https://e.com/x.png" 1x)}', "absoluteUrl"],
    ['a{background:\\49 MAGE-SET("https://e.com/x.png" 1x)}', "absoluteUrl"],
    ['a{background:\\69 mage("https://e.com/x.png")}', "absoluteUrl"],
    ['a{background:\\73 rc("https://e.com/x.png")}', "absoluteUrl"],
    ["a{background:image-set(\\76 ar(--x) 1x)}", "substitutionNotAllowed"],
  ])("%s → %s", (css, expected) => {
    expect(code(css)).toBe(expected);
  });

  it.each([
    'a{background:\\75 rl("local.png")}',
    'a{background:u\\72 l("local.png")}',
    'a{background:\\69 mage-set("local.png" 1x)}',
    'a{background:\\69 mage("local.png")}',
    'a{background:\\73 rc("local.png")}',
  ])("%s — 이스케이프해도 상대 경로는 통과한다", (css) => {
    expect(code(css)).toBe("(통과)");
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

  // CSS Variables 는 값 자리에 거의 아무 토큰열이나 허용한다. 그걸 값 문법으로 읽으면
  // 합법한 테마가 문법 오류로 거부되므로, 구조 검증 패스는 커스텀 속성 값을 읽지 않는다.
  it.each([
    ":root{--raw:{a:b}}",
    ":root{--x:https://e.com/x.png}",
    ":root{--e:cubic-bezier(.4,0,.2,1)}",
    ":root{--s:0 1px 2px rgba(0,0,0,.1)}",
    ":root{--f:-apple-system,'Segoe UI',sans-serif}",
    ":root{--c:calc(var(--a) * 2)}",
    ":root{--g:[full-start] minmax(1rem,1fr) [content-start]}",
    ':root{--t:"a: b"}',
    ":root{--empty:}",
    ":root{--icon:url(local.png)}",
  ])("%s 는 합법이다", (css) => {
    expect(code(css)).toBe("(통과)");
  });

  // 다만 커스텀 속성 값이 Raw 로 남았고 그 안에 자원 이름이 될 수 있는 토큰이 있으면
  // 아무도 그것을 검사하지 못한 것이므로 닫는다.
  it.each([
    ":root{--bad:{background:url(https://e.com/x.png)}}",
    ':root{--bad:{content:"https://e.com/x.png"}}',
  ])("%s → parseFailed (검사되지 않은 Raw)", (css) => {
    expect(code(css)).toBe("parseFailed");
  });

  // 여기 URL 은 Url 노드가 아니라 Raw 안에 통째로 들어간다 — Url 워크가 보지 못한다.
  // 이 둘은 구조 검증 패스가 먼저 잡고 Raw 관문이 두 번째 자물쇠다. 둘 중 하나만 남아도
  // 거부여야 하므로 결과로만 못을 박는다. (커스텀 속성 값 쪽은 반대로 Raw 관문이 유일한
  // 관문이다 — 아래 "검사되지 않은 Raw" 두 줄이 그것을 단독으로 고정한다.)
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
