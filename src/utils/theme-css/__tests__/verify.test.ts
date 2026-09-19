// §358 저장된 CSS 가 계약을 지키는지 **로드 시점에** 다시 본다.
//
// 설치 때 통과했다는 사실을 신뢰하지 않는다 — 규칙이 그 뒤에 강해졌을 수도, 테마
// 폴더를 사람이 건드렸을 수도 있다. (CLAUDE.md 의 Pandoc 이미지 정책이 같은 구조다:
// 세 층, 각 층은 앞 층을 불신한다.)
//
// ‼️ 이 계약은 `sanitizeThemeCss` 의 것과 **다르다**: 저쪽은 `data:` 를 거부하고
// 이쪽은 `data:` 만 받는다. 규칙을 재사용하면 자산을 가진 테마가 전부 거부된다 —
// 아래 "인라인화까지 거친 결과" 가 그 차이를 값으로 증명한다.
import { describe, expect, it } from "vitest";

import { inlineThemeAssets } from "../inline-assets";
import { sanitizeThemeCss } from "../sanitize";
import { verifyStoredThemeCss } from "../verify";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

/** 실제로 저장되는 형태 — sanitize 뒤에 inline 까지 거친 바이트. */
async function stored(
  css: string,
  files: Record<string, Uint8Array> = {},
): Promise<string> {
  return inlineThemeAssets(sanitizeThemeCss(css), async (p) => files[p]);
}

describe("verifyStoredThemeCss — 앞 층의 산물을 받아들인다", () => {
  it("위생 처리를 거친 결과는 통과한다", () => {
    expect(verifyStoredThemeCss(sanitizeThemeCss("a{color:red}"))).toBe(true);
  });

  it("인라인화까지 거친 결과도 통과한다", async () => {
    // 두 층을 실제로 통과시킨 바이트다. 여기가 빨개지면 계약이 갈린 것이고, 그
    // 증상은 "자산을 가진 테마가 설치는 되는데 적용이 안 된다" 로 나타난다.
    const css = await stored("a{background:url(assets/x.png)}", {
      "assets/x.png": PNG,
    });
    expect(css).toMatch(/data:image\/png;base64,/);
    expect(verifyStoredThemeCss(css)).toBe(true);
  });

  it("data: URI 는 통과한다 — 인라인화의 산물이다", () => {
    expect(
      verifyStoredThemeCss(
        "@layer baram-theme{a{background:url(data:image/png;base64,iVBOR)}}",
      ),
    ).toBe(true);
  });

  it("‼️ image-set 의 type() 인자는 자원이 아니다 — Task 2 가 면제한 자리", async () => {
    // 이 면제가 없으면 인라인화가 **통과시킨** CSS 를 로드 시점에 거부한다. `type()`
    // 의 인자는 media type 이고 브라우저는 그것을 가져오지 않는다(css-refs.ts).
    const css = await stored(
      'a{background:image-set("assets/x.png" type("image/png"))}',
      { "assets/x.png": PNG },
    );
    expect(css).toMatch(/type\("image\/png"\)/);
    expect(verifyStoredThemeCss(css)).toBe(true);
  });
});

describe("verifyStoredThemeCss — data: 아닌 자원 이름은 전부 거부", () => {
  it("절대 URL이 되살아나 있으면 거부한다 — 저장 후 손댄 경우", () => {
    expect(
      verifyStoredThemeCss(
        "@layer baram-theme{a{background:url(https://e.com/x)}}",
      ),
    ).toBe(false);
  });

  it("‼️ 상대 경로도 거부한다 — 계약은 '원격 없음' 이 아니라 'data: 뿐' 이다", () => {
    // sanitize 는 이것을 **허용**한다. 그러니 이 단언이 통과한다는 것은 verify 가
    // sanitize 의 규칙을 빌려 쓰지 않는다는 증거다. 인라인화를 건너뛴 CSS 가
    // 저장돼 있으면 로드 때 여기서 걸린다.
    expect(
      verifyStoredThemeCss(
        "@layer baram-theme{a{background:url(assets/x.png)}}",
      ),
    ).toBe(false);
  });

  it("이름을 이스케이프하고 따옴표를 쓴 url() 을 잡는다", () => {
    // 이쪽은 위 스캔이 본다: 함수 이름을 디코드해 비교하므로 안의 문자열이 자원 이름이 된다.
    expect(
      verifyStoredThemeCss(
        '@layer baram-theme{a{background:\\75 rl("https://e.com/x")}}',
      ),
    ).toBe(false);
  });

  it("‼️ 이름을 이스케이프한 따옴표 없는 url() 을 잡는다 — 스캔이 보지 못하는 자리", () => {
    // css-tree 토크나이저는 이것을 function-token + 잡토큰으로 쪼개므로
    // `forEachResourceName` 이 **아무것도 보지 못한다**(실측). 브라우저는 ident 를
    // 디코드한 뒤 url-token 으로 읽어 실제로 가져온다. 계약 2 의 `url(` 함수 토큰
    // 금지가 없으면 이 한 줄이 원격 fetch 를 통과시킨다.
    expect(
      verifyStoredThemeCss(
        "@layer baram-theme{a{background:\\75 rl(https://e.com/x)}}",
      ),
    ).toBe(false);
  });

  it("함수 토큰 형태의 url( 은 data: 라도 거부한다 — 우리 생성기가 내지 않는 형태다", () => {
    // 공백이 끼면 url-token 이 아니라 function-token 으로 쪼개진다. 우리 출력에는
    // 그 형태가 없다(generate 는 언제나 url-token 을 낸다) — 있다면 손으로 쓴 것이고,
    // 그 통로를 열어 두면 위 이스케이프 우회와 구분할 방법이 없다.
    expect(
      verifyStoredThemeCss(
        '@layer baram-theme{a{background:url( "data:image/png;base64,AA" )}}',
      ),
    ).toBe(false);
  });

  it("자원 함수 안에 한 겹 더 감싼 문자열도 잡는다", () => {
    expect(
      verifyStoredThemeCss(
        '@layer baram-theme{a{background:image-set(local("x.png") 1x)}}',
      ),
    ).toBe(false);
  });
});

describe("verifyStoredThemeCss — 전부 @layer baram-theme 안", () => {
  it("레이어 밖에 있으면 거부한다", () => {
    expect(verifyStoredThemeCss("a{color:red}")).toBe(false);
  });

  it("레이어 뒤에 규칙이 붙어 있으면 거부한다", () => {
    expect(
      verifyStoredThemeCss("@layer baram-theme{a{color:red}} b{color:blue}"),
    ).toBe(false);
  });

  it("다른 이름의 레이어는 거부한다", () => {
    expect(verifyStoredThemeCss("@layer evil{a{color:red}}")).toBe(false);
  });

  it("‼️ 레이어 이름은 대소문자를 가린다", () => {
    // `@layer BARAM-THEME` 은 브라우저에게 **다른** 레이어다. 소문자로 접어
    // 비교하면 나중에 선언돼 우리 것보다 세게 이기는 레이어를 우리 것으로 읽는다.
    expect(verifyStoredThemeCss("@layer BARAM-THEME{a{color:red}}")).toBe(
      false,
    );
  });

  it("레이어 이름과 at-rule 이름의 이스케이프는 푼다", () => {
    // 브라우저가 보는 것과 같은 이름으로 비교한다 — 디코드하지 않으면 멀쩡한
    // 레이어를 거부한다. (공백은 hex 이스케이프의 종결자다: `\6c ayer` 는 "layer"
    // 이고 `\6cayer` 는 `\6ca` + "yer" 라 전혀 다른 이름이다.)
    expect(
      verifyStoredThemeCss("@\\6c ayer \\62 aram-theme{a{color:red}}"),
    ).toBe(true);
  });

  it("익명 레이어와 이름만 선언하는 형태는 거부한다", () => {
    expect(verifyStoredThemeCss("@layer {a{color:red}}")).toBe(false);
    expect(verifyStoredThemeCss("@layer baram-theme;")).toBe(false);
  });

  it("레이어 목록으로 위장한 것은 거부한다", () => {
    expect(verifyStoredThemeCss("@layer baram-theme, evil{a{color:red}}")).toBe(
      false,
    );
  });

  it("안에 중첩된 레이어는 통과한다 — 그것은 우리 레이어의 하위다", () => {
    expect(
      verifyStoredThemeCss("@layer baram-theme{@layer inner{a{color:red}}}"),
    ).toBe(true);
  });
});

describe("verifyStoredThemeCss — !important 와 @import", () => {
  it("!important 가 되살아나 있으면 거부한다", () => {
    expect(
      verifyStoredThemeCss("@layer baram-theme{a{color:red !important}}"),
    ).toBe(false);
  });

  it("커스텀 속성의 !important 도 거부한다", () => {
    expect(
      verifyStoredThemeCss("@layer baram-theme{a{--x:red !important}}"),
    ).toBe(false);
  });

  it("이스케이프해 적은 !important 도 거부한다", () => {
    // css-tree 는 이 경우 `important` 를 boolean 이 아니라 원문 문자열로 준다 —
    // `=== true` 로 판정하면 그대로 통과한다.
    expect(
      verifyStoredThemeCss("@layer baram-theme{a{color:red !\\69 mportant}}"),
    ).toBe(false);
  });

  it("레이어 안의 @import 도 거부한다", () => {
    expect(
      verifyStoredThemeCss(
        '@layer baram-theme{@import "https://e.com/x.css";}',
      ),
    ).toBe(false);
  });

  it("이름을 이스케이프한 @import 도 거부한다", () => {
    expect(
      verifyStoredThemeCss('@layer baram-theme{@\\69 mport "local.css";}'),
    ).toBe(false);
  });
});
