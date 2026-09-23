// src/utils/export/__tests__/export-theme-tokens.test.ts
import type { ThemeColors, ThemeDef } from "../../../types/theme";

import { describe, expect, it } from "vitest";

import { BUILT_IN_THEMES } from "../../../types/theme";
import { generateStandaloneHTML } from "../export-html";
import { buildExportStylesheet } from "../export-html-styles";
import { themeTokensBlock } from "../export-theme-tokens";

const tokyo = BUILT_IN_THEMES.find((t) => t.id === "tokyo-night");

describe("themeTokensBlock", () => {
  it("팔레트의 25키와 파생 9+29키를 :root 블록으로 낸다", () => {
    const css = themeTokensBlock(tokyo, "dark");
    expect(css).toContain("--color-bg-default: #1a1b26");
    // derivedVars 가 따라온다는 것이 스펙 §11 의 `tokens` 정의다.
    // ‼️ `/--color-accent-[a-z-]+:/` 만으로는 이 mutation을 못 잡는다 — tokyo-night의
    // 원본 팔레트에도 `--color-accent-default`/`-hover`/`-subtle`/`-ai` 가 있어 그
    // 정규식이 derivedVars 없이도 매치한다(실측: 뺐더니 초록으로 남았다). 그래서
    // derivedVars 전용 키(`--color-accent-solid`, 원본 팔레트에는 없다)와 총 키 개수
    // (25+9+29=63)로 구분한다 — 하나는 derivedVars가 빠지면, 하나는 일부만 빠지면 잡는다.
    expect(css).toContain("--color-accent-solid:");
    expect([...css.matchAll(/^ {2}--color-[a-z-]+: /gmu)]).toHaveLength(63);
    expect(css.startsWith(":root")).toBe(true);
  });

  // §367 리뷰 I2 — 파생 29키(`DERIVED_COLOR_KEYS`)가 이 블록에서 빠져 있었다.
  //
  // 무엇이 이것을 실패시키는가: `deriveColorVars` 호출을 빼면 이 세 줄이 통째로
  // 사라진다. 개수 단언(62)과 나누는 점은 **값**이다 — 개수만으로는 "29줄이
  // 나가긴 했다" 까지만 알고 그것이 이 테마의 색인지는 모른다.
  it("파생 29키가 이 테마의 시드에서 계산된 값으로 나간다", () => {
    const css = themeTokensBlock(tokyo, "dark");
    // `--color-callout-info` 는 `hue: 0`·`lift: null` 규칙이라 강조 시드 그대로다
    // (`color-derive.ts` 의 RULES). tokyo-night 다크의 강조가 `#7aa2f7` 이다.
    expect(css).toContain("--color-callout-info: #7aa2f7;");
    // 배경 계열 둘도 같은 집합이다 — 이것이 빠지면 내보낸 문서의 호버·선택 배경이
    // `semantic-light.css` 의 기본 팔레트로 남는다.
    expect(css).toContain("--color-bg-hover: #1a1a23;");
    expect(css).toContain("--color-bg-selection: #072870;");
  });

  it("‼️ 실을 팔레트가 없으면 빈 문자열 — system 이 그 경우다 (R3)", () => {
    // "system" 은 BUILT_IN_THEMES 에 없다. findThemeById 가 undefined 를 주고,
    // 그때 tokens 는 default 와 바이트가 같은 출력을 내야 한다.
    expect(themeTokensBlock(undefined, "light")).toBe("");
  });

  it("선언하지 않은 모드를 요구하면 빈 문자열", () => {
    expect(themeTokensBlock(tokyo, "light")).toBe("");
  });
});

describe("themeTokensBlock → generateStandaloneHTML (통합)", () => {
  it("tokens 로 export 하면 활성 테마의 값이 HTML 에 들어 있다", () => {
    const html = generateStandaloneHTML("<p>x</p>", "t", {
      themeTokens: themeTokensBlock(tokyo, "dark"),
    });
    expect(html).toContain("#1a1b26");
    const light = generateStandaloneHTML("<p>x</p>", "t", {});
    expect(light).not.toContain("#1a1b26");
  });

  // ‼️ 위 테스트는 "포함되는가"만 본다 — 문자열 이어붙이기라 순서를 바꿔도 두
  // 블록 다 그대로 들어 있으므로 여전히 통과한다(실측). 커스텀 프로퍼티는
  // *마지막* 선언이 이긴다(브라우저 cascade 규칙)는 것이 buildExportStylesheet의
  // 순서 계약이므로, 그 계약은 텍스트 순서로 따로 고정한다: exportTokensCSS()도
  // `--color-bg-default`를 선언하므로(semantic-light.css), themeTokens 블록이
  // 텍스트상 그 뒤에 와야 실제로 덮어쓴다.
  it("themeTokens 는 exportTokensCSS() 의 같은 키 선언보다 뒤에 온다 — 나중 선언이 이긴다", () => {
    const sheet = buildExportStylesheet("", themeTokensBlock(tokyo, "dark"));
    const semanticIdx = sheet.indexOf("--color-bg-default:");
    const themeIdx = sheet.indexOf("--color-bg-default: #1a1b26");
    expect(semanticIdx).toBeGreaterThan(-1);
    expect(themeIdx).toBeGreaterThan(semanticIdx);
  });

  // §367 리뷰 I2 — 같은 순서 계약이 파생 29키에도 걸려야 한다. `exportTokensCSS()` 가
  // 번들하는 `semantic-light.css` 는 이 키들을 **기본 팔레트 값으로** 선언하므로,
  // 테마 블록이 그 뒤에서 덮지 않으면 내보낸 문서가 앱과 다른 색을 그린다 — 29키가
  // 이 블록에 없던 동안 실제로 그랬다(callout 이 stock 파랑·에메랄드로 인쇄됐다).
  it("파생 29키도 exportTokensCSS() 의 같은 키 선언보다 뒤에 온다", () => {
    const sheet = buildExportStylesheet("", themeTokensBlock(tokyo, "dark"));
    const semanticIdx = sheet.indexOf("--color-callout-info:");
    const themeIdx = sheet.indexOf("--color-callout-info: #7aa2f7");
    expect(semanticIdx).toBeGreaterThan(-1);
    expect(themeIdx).toBeGreaterThan(semanticIdx);
  });

  // Fix round 1, Minor 1 (task-2-review.md) — buildExportStylesheet's doc
  // comment claims "`themeTokens` is empty by default, like `fontFaceCSS`,
  // so every existing caller's output is unaffected", which is really a
  // claim about `.filter((block) => block !== "")` in its body: with both
  // slots empty, the filtered array is unchanged from before this task
  // (base commit), and the join produces no stray blank-line artifact from
  // the two new empty entries. Nothing checked that. Measured what removing
  // the filter actually does (both empty slots survive as extra `\n\n`
  // joins): the sheet gains a leading blank run before `exportTokensCSS()`'s
  // `:root {`, and a 4-newline run where `themeTokens`'s empty slot sits
  // between two joins.
  it("빈 fontFaceCSS/themeTokens 슬롯이 <style> 안에 빈 줄로 남지 않는다 (필터 고정)", () => {
    const sheet = buildExportStylesheet();
    expect(sheet.startsWith(":root")).toBe(true);
    expect(sheet).not.toMatch(/\n{3,}/u);
  });

  // Final review HIGH-1 — PDF + tokens + a dark theme printed unreadable:
  // `body { background: white; }` in `@media print` sat AFTER the theme
  // block at the same `body {}` specificity and reset only the background,
  // never `color`. So a dark theme's light `--color-editor-text` landed on
  // a forced-white page — and `export.themeInExport.darkPrintHint` told the
  // user to expect the opposite. The lead's ruling: when a theme block is
  // present, print must NOT force the background back to white (the page
  // stays dark, matching the hint and the HTML export); with no theme block
  // (default/system), the reset must still happen — pinned both directions.
  it("테마 블록이 있으면 print media가 배경을 흰색으로 되돌리지 않는다 — 안 그러면 다크 테마가 흰 바탕에 밝은 글씨로 인쇄된다", () => {
    const sheet = buildExportStylesheet("", themeTokensBlock(tokyo, "dark"));
    const printBlock = sheet.slice(sheet.indexOf("@media print"));
    expect(printBlock).not.toMatch(/body\s*\{[^}]*background:\s*white/u);
  });

  it("테마 블록이 없으면(default/system) print media는 여전히 배경을 흰색으로 되돌린다 — 기존 동작 보존", () => {
    const sheet = buildExportStylesheet();
    const printBlock = sheet.slice(sheet.indexOf("@media print"));
    expect(printBlock).toMatch(/body\s*\{[^}]*background:\s*white/u);
  });
});

// Final review MEDIUM-3 — this function's sink (a raw string later embedded
// as `<style>` text) is weaker than applyThemeVars's `setProperty` sink, and
// nothing pinned that the whitelist added actually rejects an untrusted
// object rather than merely never encountering one. `as ThemeColors` below
// is deliberate: production's five writers of `colors` already validate,
// so this bypasses that and hands the function exactly what CLAUDE.md's
// "every ingress sanitises" universal says never reaches it in practice —
// the case the hardening exists FOR, not the case it normally sees.
describe("themeTokensBlock — an untrusted colour object (final review MEDIUM-3)", () => {
  it("화이트리스트에 없는 키와 육각색이 아닌 값은 :root 블록에 새지 않는다", () => {
    const malicious = {
      ...tokyo!.modes.dark!.colors,
      "--color-bg-default": "red; } </style><script>alert(1)</script>",
      display: "none", // 진짜 CSS 프로퍼티 이름을 흉내 낸 임의 키
    } as ThemeColors;
    const evilTheme: ThemeDef = {
      ...tokyo!,
      modes: { dark: { colors: malicious } },
    };
    const css = themeTokensBlock(evilTheme, "dark");
    expect(css).not.toContain("</style>");
    expect(css).not.toContain("<script>");
    expect(css).not.toContain("display:");
    // 걸러진 키를 뺀 나머지 유효한 값은 그대로 남는다 — 통짜로 빈 문자열을
    // 돌려주는 것도 "새지 않는다"를 통과하므로, 그건 별개로 확인한다.
    expect(css).toContain("--color-bg-subtle:");
  });

  // §54 accentSolidFill(colors, base) — dark base에서는 accent 원본을
  // 검증 없이 그대로 돌려준다(color-contrast.ts). 그래서 원본 팔레트 키만 걸러도
  // 파생 9키 쪽으로 악성 값이 새어 나갈 수 있다 — derivedVars 의 결과물도
  // 같은 정규식으로 다시 걸러야 하는 이유가 바로 이 통로다.
  it("dark accentSolidFill의 원본 통과를 통해 악성 값이 파생 --color-accent-solid로 샐 수 없다", () => {
    const evilValue = "red; } </style><script>alert(1)</script>";
    const malicious = {
      ...tokyo!.modes.dark!.colors,
      "--color-accent-default": evilValue,
    } as ThemeColors;
    const evilTheme: ThemeDef = {
      ...tokyo!,
      modes: { dark: { colors: malicious } },
    };
    const css = themeTokensBlock(evilTheme, "dark");
    expect(css).not.toContain("</style>");
    expect(css).not.toContain("<script>");
    expect(css).not.toContain("--color-accent-default:");
    expect(css).not.toContain("--color-accent-solid:");
    expect(css).not.toContain("--color-accent-solid-hover:");
    // onSolidForeground는 입력을 되읽지 않고 항상 안전한 상수(WHITE/BLACK)를
    // 돌려주므로(color-contrast.ts, 파싱 불가 입력은 WHITE 유지가 문서화된
    // pre-#330 동작) 그 한 줄은 걸러지지 않고 그대로 남아야 한다 —
    // "필터가 파생 블록 전체를 지운다"는 다른 결함과 구분하기 위한 양성 대조.
    expect(css).toContain("--color-accent-on-solid: #ffffff;");
  });
});
