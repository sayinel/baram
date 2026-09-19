// §358 테마 자산 인라인화 — 통과한 CSS 에는 `data:` 아닌 URL 이 남지 않는다.
//
// ‼️ 이 함수의 URL 규칙은 `sanitizeThemeCss` 와 **다르다**. 저쪽은 패키지 상대 경로만
// 허용하고 `data:` 를 거부하며, 이쪽은 그 상대 경로를 읽어 `data:` 로 바꾼다. 같은
// 규칙이라고 읽으면 자산을 가진 테마가 전부 거부된다.
import { describe, expect, it, vi } from "vitest";

import { forEachResourceName } from "../css-refs";
import { ThemeCssError } from "../errors";
import { inlineThemeAssets, MAX_THEME_ASSET_BYTES } from "../inline-assets";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function code(error: unknown): string {
  return error instanceof ThemeCssError ? error.code : `(${String(error)})`;
}

const reader =
  (map: Record<string, Uint8Array>) =>
  async (p: string): Promise<Uint8Array | undefined> =>
    map[p];

/** 던진 `ThemeCssError` 의 코드. 통과하면 그 사실이 보이도록 문자열로 돌려준다. */
async function rejection(css: string, files: Record<string, Uint8Array> = {}) {
  try {
    await inlineThemeAssets(css, reader(files));
    return "(통과)";
  } catch (e) {
    return code(e);
  }
}

describe("inlineThemeAssets — 상대 참조를 data: 로", () => {
  it("상대 url()을 data: URI로 바꾼다", async () => {
    const out = await inlineThemeAssets(
      "a{background:url(assets/x.png)}",
      reader({ "assets/x.png": PNG }),
    );
    expect(out).toMatch(/url\(["']?data:image\/png;base64,/);
    expect(out).not.toMatch(/assets\/x\.png/);
  });

  it("확장자로 media type을 고른다", async () => {
    const out = await inlineThemeAssets(
      "@font-face{src:url(assets/f.woff2)}",
      reader({ "assets/f.woff2": PNG }),
    );
    expect(out).toMatch(/data:font\/woff2;base64,/);
  });

  it("SVG 도 base64 로 싣는다 — raw 형태는 인용 규칙이 까다롭다", async () => {
    const out = await inlineThemeAssets(
      "a{background:url(assets/i.svg)}",
      reader({ "assets/i.svg": PNG }),
    );
    expect(out).toMatch(/data:image\/svg\+xml;base64,/);
  });

  it("확장자 비교는 대소문자를 가리지 않는다", async () => {
    const out = await inlineThemeAssets(
      "a{background:url(assets/X.PNG)}",
      reader({ "assets/X.PNG": PNG }),
    );
    expect(out).toMatch(/data:image\/png;base64,/);
  });

  it("경로의 `./` 는 접어서 읽는다", async () => {
    const out = await inlineThemeAssets(
      "a{background:url(./assets/./x.png)}",
      reader({ "assets/x.png": PNG }),
    );
    expect(out).toMatch(/data:image\/png;base64,/);
  });

  it("자원 이름을 받는 함수의 <string> 인자도 인라인한다", async () => {
    const out = await inlineThemeAssets(
      'a{background:image-set("assets/x.png" 1x)}',
      reader({ "assets/x.png": PNG }),
    );
    expect(out).toMatch(/data:image\/png;base64,/);
    expect(out).not.toMatch(/assets\/x\.png/);
  });

  it("한 겹 더 감싼 <string> 도 인라인한다 — 워크가 못 보면 저장 뒤에 거부된다", async () => {
    const out = await inlineThemeAssets(
      'a{background:image-set(local("assets/x.png"))}',
      reader({ "assets/x.png": PNG }),
    );
    expect(out).toMatch(/data:image\/png;base64,/);
  });

  it("같은 경로를 두 번 참조하면 한 번만 읽는다", async () => {
    const read = vi.fn(reader({ "assets/x.png": PNG }));
    const out = await inlineThemeAssets(
      "a{background:url(assets/x.png)}b{background:url(assets/x.png)}",
      read,
    );
    expect(read).toHaveBeenCalledTimes(1);
    expect(out.match(/data:image\/png;base64,/g)).toHaveLength(2);
  });

  it("참조가 없으면 입력을 그대로 돌려준다", async () => {
    const css = "@layer baram-theme {\na{color:red}\n}\n";
    expect(await inlineThemeAssets(css, reader({}))).toBe(css);
  });

  // 테마가 실제로 가장 많이 쓰는 모양이다. `local()`·`format()` 의 문자열은 자원 이름이
  // 아니고(둘 다 `src:` 선언 아래라 자원 이름을 받는 **함수** 안이 아니다), 그것을 자원으로
  // 읽으면 서체를 싣는 테마가 "없는 파일" 로 전부 거부된다.
  it("@font-face 의 local()·format() 문자열은 건드리지 않는다", async () => {
    const out = await inlineThemeAssets(
      '@font-face{font-family:X;src:local("Foo"),url(f.woff2) format("woff2")}',
      reader({ "f.woff2": PNG }),
    );
    expect(out).toContain('local("Foo")');
    expect(out).toContain('format("woff2")');
    expect(out).toMatch(/data:font\/woff2;base64,/);
  });

  it("sanitize 가 씌운 @layer 래퍼를 잃지 않는다", async () => {
    const out = await inlineThemeAssets(
      "@layer baram-theme {\na{background:url(assets/x.png)}\n}\n",
      reader({ "assets/x.png": PNG }),
    );
    expect(out).toContain("@layer baram-theme{");
  });
});

describe("inlineThemeAssets — 심은 값이 다시 토큰으로 보인다", () => {
  // ‼️ 이 모듈은 노드를 **고쳐 쓴 뒤** generate 한다. 그러니 "워크가 본 것 = 스캔이 읽는
  // 것" 이 아니고, 스캔은 워크의 판정을 되풀이하는 게 아니라 **결과 바이트**를 따로 본다.
  // 그 관계가 성립하려면 우리가 심은 값이 토큰 수준에서 다시 보여야 한다.
  //
  // css-tree v3 의 `Url` generate 는 언제나 따옴표 없는 url-token 하나를 낸다(따옴표가
  // 필요한 문자는 `\` 이스케이프로 처리한다). 이 테스트는 그 사실이 아니라 **그 사실이
  // 지켜야 하는 성질**을 고정한다 — css-tree 가 `url("…")` 로 바꾸는 날에도 값은
  // `url` 이 `URL_BEARING_FUNCTIONS` 에 있는 덕에 스캔에 잡혀야 한다.
  it.each([
    ["a{background:url(assets/x.png)}", "url()"],
    ['a{background:image-set("assets/x.png" 1x)}', "image-set() 의 <string>"],
    [
      'a{background:image-set(local("assets/x.png"))}',
      "한 겹 더 감싼 <string>",
    ],
    ["@font-face{src:url(assets/x.png)}", "@font-face"],
    [":root{--bg:url(assets/x.png)}", "커스텀 속성"],
  ])("%s — 출력 스캔이 심은 값에 도달한다 (%s)", async (css) => {
    const out = await inlineThemeAssets(css, reader({ "assets/x.png": PNG }));
    const seen: string[] = [];
    forEachResourceName(out, (value) => seen.push(value));
    expect(seen).not.toHaveLength(0);
    for (const value of seen) expect(value).toMatch(/^data:image\/png;base64,/);
  });
});

describe("inlineThemeAssets — 해석할 수 없는 참조는 거부다", () => {
  it("패키지 밖을 가리키면 거부한다 — 경로 탈출", async () => {
    await expect(
      inlineThemeAssets("a{background:url(../../../etc/passwd)}", reader({})),
    ).rejects.toBeInstanceOf(ThemeCssError);
    expect(await rejection("a{background:url(../../../etc/passwd)}")).toBe(
      "assetPathNotAllowed",
    );
  });

  it("패키지 안에서 시작해도 밖으로 나가면 거부한다", async () => {
    expect(await rejection("a{background:url(assets/../../x.png)}")).toBe(
      "assetPathNotAllowed",
    );
  });

  // ‼️ sanitize 는 이것을 통과시킨다. 두 probe base 에서 href 가 갈리므로 상대 참조로
  // 읽히기 때문이다 — 패키지 안의 파일이 아니라는 판정은 여기서만 한다.
  it("루트 절대 경로는 거부한다", async () => {
    expect(await rejection("a{background:url(/x.png)}")).toBe(
      "assetPathNotAllowed",
    );
  });

  it("역슬래시가 섞인 경로는 거부한다 — Windows 에서 구분자다", async () => {
    expect(
      await rejection("a{background:url(assets\\\\..\\\\..\\\\x.png)}"),
    ).toBe("assetPathNotAllowed");
  });

  it("조각·쿼리가 붙은 참조는 거부한다 — 패키지의 파일 이름이 아니다", async () => {
    expect(await rejection("a{background:url(#gradient)}")).toBe(
      "assetPathNotAllowed",
    );
    expect(await rejection("a{background:url(assets/x.png?v=1)}")).toBe(
      "assetPathNotAllowed",
    );
  });

  it("없는 파일은 거부한다 — 조용히 빈 url을 남기지 않는다", async () => {
    await expect(
      inlineThemeAssets("a{background:url(assets/missing.png)}", reader({})),
    ).rejects.toBeInstanceOf(ThemeCssError);
    expect(await rejection("a{background:url(assets/missing.png)}")).toBe(
      "assetNotFound",
    );
  });

  it("알 수 없는 확장자는 거부한다 — 임의 media type을 만들지 않는다", async () => {
    await expect(
      inlineThemeAssets(
        "a{background:url(assets/x.exe)}",
        reader({ "assets/x.exe": PNG }),
      ),
    ).rejects.toBeInstanceOf(ThemeCssError);
    expect(
      await rejection("a{background:url(assets/x.exe)}", {
        "assets/x.exe": PNG,
      }),
    ).toBe("assetTypeNotAllowed");
  });

  it("확장자가 아예 없어도 거부한다", async () => {
    expect(
      await rejection("a{background:url(assets/x)}", { "assets/x": PNG }),
    ).toBe("assetTypeNotAllowed");
  });

  it("원격 URL 은 absoluteUrl 이다 — 읽기 실패로 뭉뚱그리지 않는다", async () => {
    expect(await rejection("a{background:url(https://e.com/x.png)}")).toBe(
      "absoluteUrl",
    );
  });

  // ‼️ 두 번 돌릴 수 없다. `data:` 는 절대 URL 이므로 sanitize 와 같은 판정을 받는다 —
  // 손으로 쓴 `data:` 가 자산 상한을 우회하는 것을 막는 규칙과 같은 자리다.
  it("이미 data: 인 입력은 거부한다", async () => {
    expect(
      await rejection("a{background:url(data:image/png;base64,AAAA)}"),
    ).toBe("absoluteUrl");
  });
});

describe("inlineThemeAssets — 자산 예산", () => {
  it("상한은 2 MiB 다", () => {
    expect(MAX_THEME_ASSET_BYTES).toBe(2 * 1024 * 1024);
  });

  it("자산 총합이 상한을 넘으면 tooLarge 로 거부한다", async () => {
    const big = new Uint8Array(3 * 1024 * 1024);
    await expect(
      inlineThemeAssets(
        "a{background:url(assets/big.png)}",
        reader({ "assets/big.png": big }),
      ),
    ).rejects.toMatchObject({ code: "tooLarge" });
  });

  it("상한은 자산 하나가 아니라 누적으로 센다", async () => {
    const half = new Uint8Array(1024 * 1024 + 1);
    expect(
      await rejection("a{background:url(a.png)}b{background:url(b.png)}", {
        "a.png": half,
        "b.png": half,
      }),
    ).toBe("tooLarge");
  });

  it("상한 안이면 통과한다", async () => {
    const fits = new Uint8Array(1024 * 1024);
    const out = await inlineThemeAssets(
      "a{background:url(a.png)}",
      reader({ "a.png": fits }),
    );
    expect(out).toMatch(/data:image\/png;base64,/);
  });

  // 중복 참조를 두 번 세면 예산이 실제보다 빨리 소진된다.
  it("같은 자산을 두 번 참조해도 예산은 한 번만 쓴다", async () => {
    const big = new Uint8Array(1024 * 1024 + 1);
    const out = await inlineThemeAssets(
      "a{background:url(a.png)}b{background:url(a.png)}",
      reader({ "a.png": big }),
    );
    expect(out).toMatch(/data:image\/png;base64,/);
  });
});

describe("inlineThemeAssets — 내보낼 바이트를 다시 훑는다", () => {
  // `type()` 의 인자는 media type 이지 자원 이름이 아니다(CSS Images 4). 이것을
  // 자원으로 읽으면 합법한 테마가 "없는 파일" 로 거부된다. 원격으로 보이는 문자열은
  // 여기 오기 전에 sanitize 가 이미 거부하므로 이 예외가 구멍을 만들지는 않는다.
  it("image-set 의 type() 인자는 자원 이름이 아니다", async () => {
    const out = await inlineThemeAssets(
      'a{background:image-set(url(assets/x.png) type("image/png"))}',
      reader({ "assets/x.png": PNG }),
    );
    expect(out).toContain('type("image/png")');
    expect(out).toMatch(/data:image\/png;base64,/);
  });
});
