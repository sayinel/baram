// §5.1 — the editor's list geometry must be DERIVED, and its colours must be colours
// every theme actually sets.
//
// Both halves guard defects that were live in the styling this replaces:
//
//   * Hand-tuned constants. The fold arrow's height was `1.95em` "tuned in WebKit
//     against the real editor font", and the task checkbox was `14px`. But
//     `use-settings-effects.ts` writes BOTH `fontSize` and `lineHeight` from user
//     settings, so those two numbers are right at exactly one setting each: raise the
//     editor font to 22px and the checkbox stays 14px; set line height to 2.0 and the
//     arrow no longer sits on the marker it points at.
//
//   * Theme-blind tokens. A completed task's text used `--color-text-muted`, which is
//     NOT in `THEME_COLOR_KEYS` — so it keeps its default value under Nord, Solarized
//     and Tokyo Night instead of following the theme. This is the same shape as the
//     §30 graph-colour bug: a token that resolves to *something* everywhere, so
//     nothing looks broken until you switch themes.
//
// Asserted over the whole stylesheet rather than site by site, so the next list rule
// someone adds inherits the constraint instead of re-opening the hole.
import { describe, expect, it } from "vitest";

import { DIALS } from "../../appearance/dials";
import { THEME_COLOR_KEYS } from "../../types/theme";
import { DERIVED_KEYS } from "../../utils/theme-vars";
import {
  cssDeclarations,
  cssRules,
  selectorParts,
  selectorTarget,
} from "./css-rules";

const RULES = cssRules();

/** Properties whose value is a length the editor's font settings should scale. */
const SCALED =
  /^(?:(?:min-|max-)?(?:width|height)|top|right|bottom|left|inset|gap|font-size|(?:margin|padding|border)(?:-(?:top|right|bottom|left|width))?)$/;

/**
 * Rules that style the editor's lists.
 *
 * `.fold-arrow` is included without a `.tiptap` scope on purpose: `fold.ts` emits that
 * widget for list items ONLY — headings fold through a `::before` pseudo-element and a
 * `fold-collapsed` node class instead (see the comment at `buildDecorations`). So every
 * `.fold-arrow` rule is a list rule, including the base one whose selector never
 * mentions a list.
 */
const LIST_RULES = RULES.filter((rule) =>
  selectorParts(rule.selector).some(
    (part) =>
      part.includes(".fold-arrow") ||
      (part.includes(".tiptap") &&
        /\b(?:ul|ol|li)\b|taskList|taskItem/u.test(part)),
  ),
);

/** Does this selector style a list CONTAINER (a `<ul>`/`<ol>`), rather than an item? */
function targetsListContainer(part: string): boolean {
  return /^(?:ul|ol)\b/u.test(selectorTarget(part));
}

function where(rule: { file: string; line: number; selector: string }): string {
  return `${rule.file}:${rule.line} ${rule.selector}`;
}

describe("editor list styling", () => {
  it("scanned the list rules", () => {
    // A floor on the sweep, not on the finding: if the selector predicate broke, every
    // assertion below would pass over an empty list.
    expect(RULES.length).toBeGreaterThan(1000);
    expect(LIST_RULES.length).toBeGreaterThanOrEqual(15);
  });
});

describe("nested list rhythm", () => {
  const nested = LIST_RULES.filter((rule) =>
    selectorParts(rule.selector).some(
      (part) => /\bli\b/u.test(part) && targetsListContainer(part),
    ),
  );

  it("zeroes the outer margin of a nested list", () => {
    // The dominant reason nested lists read as detached: `.tiptap ul, .tiptap ol` set
    // `margin: 0.5em 0`, which applies to nested lists too. Sibling items sit 0.15em
    // apart, so a parent was more than three times farther from its own children than
    // from its neighbours — exactly backwards.
    const zeroing = nested.filter((rule) =>
      cssDeclarations(rule.body).some(
        (declaration) =>
          declaration.prop === "margin" && /^0\b/u.test(declaration.value),
      ),
    );
    expect(zeroing.map(where).length).toBeGreaterThan(0);
  });

  it("never gives a nested-list selector a non-zero margin", () => {
    // Scoped to selectors that NAME a nested list, which is narrower than it first looks
    // like it should be — and deliberately so. The unscoped `.tiptap ul, .tiptap ol`
    // margin is correct and stays: a list inside a callout, a blockquote or a table cell
    // wants the same separation a paragraph gets there, and the alternative — enumerating
    // the containers that deserve a margin — makes the next container someone adds
    // default to none. So the default is a margin, the exception is being inside a list
    // item, and the exception wins on specificity (`.tiptap li ul` adds an element to
    // `.tiptap ul`). What that leaves worth guarding is a MORE specific nested rule
    // handing the margin back.
    const offenders = nested
      .filter((rule) =>
        cssDeclarations(rule.body).some(
          (declaration) =>
            /^margin(?:-top|-bottom)?$/u.test(declaration.prop) &&
            !/^0(?:\s|$)/u.test(declaration.value),
        ),
      )
      .map(where);
    expect(offenders).toEqual([]);
  });

  it("separates a top-level list from surrounding prose", () => {
    // The positive half: the nested gap collapsing to zero is only an improvement if the
    // top level still breathes. Written as a direct child of `.tiptap` so it cannot be
    // the rule the test above has to worry about.
    const topLevel = LIST_RULES.filter((rule) =>
      selectorParts(rule.selector).some(
        (part) =>
          /\.tiptap\s*>\s*(?:ul|ol)\b/u.test(part) &&
          cssDeclarations(rule.body).some(
            (declaration) =>
              declaration.prop === "margin" &&
              !/^0(?:\s|$)/u.test(declaration.value),
          ),
      ),
    );
    expect(topLevel.map(where).length).toBeGreaterThan(0);
  });
});

describe("list marker rendering", () => {
  it("keeps markers off the native ::marker", () => {
    // Not a new constraint — a regression guard for one already paid for. Under
    // `.editor-area-scroll`'s CSS `zoom`, WKWebView paints the text caret ~1 character
    // into a list item whenever a native `::marker` is present. Markers are `::before`
    // pseudo-elements for that reason, and `list-style: none` is what suppresses the
    // native one.
    const suppressing = LIST_RULES.filter((rule) =>
      cssDeclarations(rule.body).some(
        (declaration) =>
          declaration.prop === "list-style" && declaration.value === "none",
      ),
    );
    expect(suppressing.length).toBeGreaterThan(0);

    const revived = RULES.filter((rule) =>
      selectorParts(rule.selector).some(
        (part) => part.includes(".tiptap") && part.includes("::marker"),
      ),
    ).map(where);
    expect(revived).toEqual([]);
  });

  it("steps the ordered-list counter style once per depth", () => {
    // Every depth used `counter(list-item)`, so nested ordered lists read `1. 1. 1.`
    // with nothing but indentation to tell the levels apart.
    //
    // Counted, not merely found: asserting that each style "appears somewhere" would
    // stay green if a fourth depth re-used `lower-alpha`, which is the mistake this
    // cascade invites.
    const styles = LIST_RULES.flatMap((rule) =>
      [
        ...rule.body.matchAll(
          /counter\(\s*list-item\s*(?:,\s*([\w-]+))?\s*\)/gu,
        ),
      ].map((match) => match[1] ?? "decimal"),
    );
    expect([...styles].sort()).toEqual([
      "decimal",
      "lower-alpha",
      "lower-roman",
    ]);
  });
});

describe("list geometry", () => {
  it("sizes every length in font-relative units", () => {
    // `px` here means "ignores the user's font size". This carried a `1px` exemption for
    // the indent guide while the guide was a hairline; the guide is now `0.125em`, so the
    // exemption was covering nothing and is gone. `outline` is deliberately outside
    // SCALED — a focus ring is device chrome and should not grow with the prose.
    //
    // Custom properties are checked too, and that is not belt-and-braces: this file's
    // lengths all reach their consumers THROUGH one (`--guide-width`, `--marker-size`,
    // `--checkbox-size`, `--list-gutter`). A name-list of standard properties is an
    // enumeration over an unbounded space — `--guide-width: 1px` survived this mutation
    // until custom properties were added, because no standard property name matched.
    const offenders = LIST_RULES.flatMap((rule) =>
      cssDeclarations(rule.body)
        .filter(
          (declaration) =>
            (SCALED.test(declaration.prop) ||
              declaration.prop.startsWith("--")) &&
            /(?<![\w.])\d*\.?\d+px/u.test(declaration.value),
        )
        .map(
          (declaration) =>
            `${where(rule)} { ${declaration.prop}: ${declaration.value} }`,
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("measures the ordered gutter in ch, and steps it in source order", () => {
    // Two separate ways this rule set breaks silently.
    //
    // ONE — a digit width written in `em` is a guess about whichever font actually renders.
    // Since §347 the app bundles Pretendard Variable and declares its @font-face, but `em`
    // is still a guess: it scales with the *loaded* font's digit width, and that is only
    // Pretendard's on a machine where the bundled face actually took over the fallback
    // stack. `ch` is the font's own "0" advance, so the gutter is correct on every machine
    // instead of on the author's. Any ordered gutter that widens for digits must therefore
    // use `ch`.
    //
    // Scoped to the rules that WIDEN for digits. The base `.tiptap ul, .tiptap ol` floor is
    // a plain `1.4em` and correctly so — it is the bullet-list indent, not a digit
    // measurement — so a predicate of "mentions ol and sets --list-gutter" reports it as a
    // guess and the test fails on correct code.
    //
    // ‼️ 술어는 "마커 폭을 **예약하는**" 규칙이어야 한다. 값이 `calc()` 인 것이 그
    // 판별자다 — 자릿수 리셋(`[start="2"]:not(:has(…))`)은 바닥 `1.4em` 을 **돌려주는**
    // 규칙이라 잴 것이 없고, 선택자만 보는 술어는 그것을 "추측" 으로 신고한다.
    const orderedGutters = LIST_RULES.filter(
      (rule) =>
        /\bol\b/u.test(rule.selector) &&
        /nth-child|\[start\]/u.test(rule.selector) &&
        cssDeclarations(rule.body).some(
          (d) => d.prop === "--list-gutter" && d.value.includes("calc("),
        ),
    );
    expect(orderedGutters.length).toBeGreaterThanOrEqual(2);
    const guessed = orderedGutters
      .filter(
        (rule) =>
          !(
            cssDeclarations(rule.body).find((d) => d.prop === "--list-gutter")
              ?.value ?? ""
          ).includes("ch"),
      )
      .map(where);
    expect(guessed).toEqual([]);

    // TWO — `:has(> li:nth-child(10))` and `:has(> li:nth-child(100))` have IDENTICAL
    // specificity, so only source order decides which wins for a list of 100+ items. Swap
    // them and three-digit lists quietly get the two-digit gutter; nothing else changes,
    // and no other assertion here would notice.
    const at = (n: number) =>
      orderedGutters.find((rule) => rule.selector.includes(`nth-child(${n})`));
    const two = at(10);
    const three = at(100);
    expect(two).toBeDefined();
    expect(three).toBeDefined();
    // `index` is a character offset within one file, so comparing across files would be
    // meaningless. Assert they share one before ordering them.
    expect(three?.file).toBe(two?.file);
    expect(three?.index).toBeGreaterThan(two?.index as number);
  });

  it("aligns the ordered marker in a box the gutter sizes", () => {
    // §5.1 마커 정렬 축. 마커에 거터 폭의 상자를 주고 그 안에서 텍스트를 정렬한다 —
    // 상자가 있어야 "마침표 기준" 과 "숫자 기준" 이 **같은 기하의 두 정렬**이 되고,
    // 두 개의 서로 다른 앵커가 되지 않는다.
    //
    // 무엇이 이것을 실패시키는가, 넷이다.
    //
    // ① fallback 과 다이얼 기본값이 갈리면, 사용자가 select 를 처음 건드리는 순간
    //    화면이 튄다 — 기본 출처의 다이얼은 변수를 쓰지 않으므로(`apply.ts`)
    //    건드리기 전까지는 fallback 이 지배한다. 한쪽만 고치는 것을 막으려고 두 파일을
    //    여기서 함께 읽는다(§369 농도 다이얼과 같은 형태).
    // ② `text-align` 을 리터럴로 적으면 다이얼이 조용히 무의미해진다.
    // ③ 상자 폭을 상수로 다시 적으면 거터·폴딩 삼각형과 드리프트한다. 폭은
    //    `--list-gutter` 에서 파생돼야 하고, 그 변수 하나가 마커·안내선·화살표를
    //    같은 공간의 세 위치로 묶는다(이 파일 상단 주석).
    // ④ `left` 앵커를 더하면 `right: 100%` 와 싸워 "마침표 기준" 이 오늘 화면과
    //    픽셀 단위로 같기를 그친다 — 그쪽은 아무것도 바꾸지 않기로 한 값이다.
    const dial = DIALS.find((d) => d.id === "editorOrderedMarkerAlign");
    expect(dial).toBeDefined();
    // 값 이름 → CSS 값. 기본값 쪽의 CSS 값은 `toVars` 에서 읽을 수 없다 — 기본
    // 출처의 다이얼은 일부러 변수를 쓰지 않기 때문이다(`apply.ts`). 그래서 이 대응은
    // 여기 한 번 적고, 나머지 절반(`period` → `right`)은 `appearance/__tests__/
    // dials.test.ts` 가 `toVars` 에서 고정한다. `Record<string, string>` 인 것은
    // `DIALS` 가 `as const` 라 `defaultValue` 가 리터럴 타입이어서다 — 리터럴끼리
    // 비교하면 tsc 가 "겹치지 않는다"(TS2367)고 거부한다.
    const CSS_VALUE: Readonly<Record<string, string>> = {
      number: "left",
      period: "right",
    };
    const expectedFallback = CSS_VALUE[String(dial?.defaultValue)];
    expect(expectedFallback).toBeDefined();

    const orderedMarkers = LIST_RULES.filter(
      (rule) =>
        selectorParts(rule.selector).some(
          (part) =>
            /\bol\b/u.test(part) && /^li::before$/u.test(selectorTarget(part)),
        ) && /counter\(\s*list-item/u.test(rule.body),
    );
    expect(orderedMarkers.length).toBeGreaterThan(0);

    // 정렬을 말하는 규칙은 **하나**여야 한다. 깊이별 규칙(alpha·roman)이 저마다
    // 정렬을 말하기 시작하면 한 문서 안에서 단계마다 정렬이 달라진다.
    const aligned = orderedMarkers.filter((rule) =>
      cssDeclarations(rule.body).some((d) => d.prop === "text-align"),
    );
    expect(aligned.map(where)).toHaveLength(1);

    const declarations = cssDeclarations(aligned[0].body);
    const align =
      declarations.find((d) => d.prop === "text-align")?.value ?? "";
    const fallback =
      /^var\(\s*--editor-ordered-marker-align\s*,\s*([a-z]+)\s*\)$/u.exec(
        align,
      );
    expect(fallback).not.toBeNull();
    expect(fallback?.[1]).toBe(expectedFallback);

    const box = declarations.find((d) => d.prop === "min-width")?.value ?? "";
    expect(box).toContain("var(--list-gutter)");
    // 고정 `width` 가 아니라 `min-width` 인 것도 계약이다. 거터가 재지 못하는 마커가
    // 있다 — CSS 는 `start` 를 읽을 수 없어 `<ol start="100">` 의 3자리 번호가 2자리
    // 거터를 받고, `lower-roman` 의 `viii.` 는 애초에 자릿수로 재지지 않는다. 그때
    // shrink-to-fit 이 남아 있어야 상자가 **왼쪽으로** 자라 오늘처럼 여백으로 흘러
    // 나간다. 고정 폭이면 같은 마커가 숫자 기준에서 본문 쪽으로 밀려, 다이얼이
    // 넘침의 방향을 바꾸는 물건이 된다.
    expect(declarations.find((d) => d.prop === "width")).toBeUndefined();
    expect(declarations.find((d) => d.prop === "left")).toBeUndefined();
  });

  it("keeps the fold arrow clear of both kinds of marker, by the same margin", () => {
    // 이 화살표↔마커 간격은 사람이 보고 고른 값이다 — 앱에서 "삼각형이 숫자에 너무
    // 붙어 있다" 는 보고를 받아 두 목록 모두 넓혔다. 그 판단을 다시 받아 오려면
    // 간격이 **유도**돼야 하는데, 간격은 네 선언에 흩어져 있어(거터·화살표 오프셋·
    // 마커 치수·화살표가 칠하는 폭) 어느 하나만 손대도 조용히 좁아진다. 그래서 여기서
    // 네 값을 전사해 간격을 계산한다.
    //
    // 기하(둘 다 리스트의 왼쪽 모서리 기준):
    //   화살표 상자 = [-offset, -offset + 1em] 이고 그 안에서 화살표가 칠하는 폭 `w` 가 가운데
    //     → 칠해진 오른끝 = -offset + 0.5em + w/2
    //   순서 있는 마커의 왼끝 = S           (`min-width: calc(gutter - S)`, 오른끝은 거터 끝)
    //   글머리 기호의 왼끝   = gutter - 0.5em - size/2   (`margin-right: (1em - size)/2`)
    //
    // 무엇이 이것을 실패시키는가: 오프셋을 되돌리거나, 마커 상자를 넓히거나, 화살표
    // 상자를 키우면 간격이 줄어 red 가 된다. 두 목록의 간격이 갈라져도 red 다 — 갈라지면 한
    // 문서 안에서 글머리 기호와 번호가 서로 다른 리듬으로 읽힌다.
    const em = (value: string): number =>
      Number(/(-?[\d.]+)em/u.exec(value)?.[1]);
    const decl = (selector: string, prop: string): string => {
      const rule = LIST_RULES.find(
        (r) => r.selector.replaceAll(/\s+/gu, " ") === selector,
      );
      expect(rule, `no rule for ${selector}`).toBeDefined();
      const found = cssDeclarations(rule?.body ?? "").find(
        (d) => d.prop === prop,
      );
      expect(found, `${selector} has no ${prop}`).toBeDefined();
      return found?.value ?? "";
    };

    const gutter = em(decl(".tiptap ul, .tiptap ol", "--list-gutter"));
    const bulletOffset = em(
      decl(".tiptap ul, .tiptap ol", "--list-arrow-offset"),
    );
    const orderedOffset = em(decl(".tiptap ol", "--list-arrow-offset"));
    // `--marker-size` 는 두 목록이 함께 쓰는 규칙에 있다(그것이 마커들이 같은 1em 열을
    // 공유하는 자리다). 글머리 기호 전용 규칙에서 찾으면 없다.
    const markerSize = em(
      decl(".tiptap ul > li::before, .tiptap ol > li::before", "--marker-size"),
    );

    // 유도가 성립하려면 두 선언이 유도가 가정한 **모양**이어야 한다. 값만 읽고 모양을
    // 보지 않으면, 형태가 바뀐 날 이 테스트는 숫자를 맞게 계산해 초록으로 거짓말한다.
    const bulletMargin = decl(".tiptap ul > li::before", "margin-right");
    expect(bulletMargin.replaceAll(/\s+/gu, "")).toBe(
      "calc((1em-var(--marker-size))/2)",
    );
    const orderedBox = decl(".tiptap ol > li::before", "min-width");
    const subtrahend = Number(
      /^calc\(\s*var\(--list-gutter\)\s*-\s*([\d.]+)em\s*\)$/u.exec(
        orderedBox,
      )?.[1],
    );
    expect(subtrahend).toBeGreaterThan(0);

    // 화살표는 `.fold-arrow::before` 상자에 lucide chevron-right 를 mask 로 칠한 것이다
    // (icons.css). 칠해지는 폭은 상자 폭의 8/24 다 — 경로 `m9 18 6-6-6-6` 이 x 9–15 를
    // 지나고 획 2 가 양쪽으로 1 씩 넓혀 8–16 을 칠하며, 그 가운데(12)가 상자 가운데라
    // 좌우 대칭이다. 이 분수는 경로에서 나오므로 경로가 그 경로인지부터 단정한다.
    const arrow = RULES.find(
      (r) => r.selector.trim() === ".fold-arrow::before",
    );
    expect(arrow).toBeDefined();
    const arrowDecls = cssDeclarations(arrow?.body ?? "");
    expect(
      arrowDecls.find((d) => d.prop === "mask")?.value.replaceAll(/\s+/gu, " "),
    ).toBe("var(--icon-chevron-right) center / contain no-repeat");
    const chevron = cssDeclarations(
      RULES.find(
        (r) => r.file.endsWith("/styles/icons.css") && r.selector === ":root",
      )?.body ?? "",
    ).find((d) => d.prop === "--icon-chevron-right")?.value;
    expect(chevron).toContain("d='m9 18 6-6-6-6'");
    const arrowWidth =
      em(arrowDecls.find((d) => d.prop === "width")?.value ?? "") * (8 / 24);
    expect(arrowWidth).toBeGreaterThan(0);

    const triangleRight = (offset: number) => -offset + 0.5 + arrowWidth / 2;
    const orderedGap = subtrahend - triangleRight(orderedOffset);
    const bulletGap =
      gutter - 0.5 - markerSize / 2 - triangleRight(bulletOffset);

    // 0.3em 은 보고를 받고 고른 바닥이다. 그 아래로 내려가면 다시 "붙어 보인다" 가 된다.
    expect(orderedGap).toBeGreaterThanOrEqual(0.3);
    expect(bulletGap).toBeGreaterThanOrEqual(0.3);
    expect(Math.abs(orderedGap - bulletGap)).toBeLessThanOrEqual(0.05);
  });

  it("reserves what a letter or roman marker measures, not what a digit does", () => {
    // 거터는 자릿수를 센다. 깊이 2·3 의 마커는 글자와 로마자라 그 치수가 거짓이고,
    // 거짓인 쪽은 읽는 사람이 본다 — 로마자 리스트는 `xv.` 까지 거터 안에 있다가
    // `xvi.` 부터 넘쳐 shrink-to-fit 이 상자를 왼쪽으로 키우고 첫 글자들이 줄을 잃는다
    // (앱에서 보고된 증상이다). 그래서 깊이별로 **그 마커의 실측 폭**을 예약한다.
    //
    // 무엇이 이것을 실패시키는가, 넷이다.
    // ① 깊이 규칙이 사라지면 깊이 2·3 이 다시 십진 거터를 상속해 드리프트가 돌아온다.
    // ② 예약을 `em` 으로 적으면 우리가 싣지 않는 서체에 대한 추측이 된다(`ch` 만 허용).
    // ③ 깊이 규칙이 십진 규칙보다 **앞에** 오면 명시도가 같은 자리에서 져 무효가 된다.
    // ④ `[start]` 변형이 빠지면, `3.` 으로 시작하는 하위 목록에서 십진 start 규칙이
    //    깊이 규칙을 이겨 그 리스트만 십진 거터를 받는다 — 한 문서 안에서만 갈린다.
    const depthGutters = LIST_RULES.filter(
      (rule) =>
        /ol\s+ol/u.test(rule.selector) &&
        cssDeclarations(rule.body).some((d) => d.prop === "--list-gutter"),
    );
    expect(depthGutters.length).toBeGreaterThanOrEqual(2);

    const offenders: string[] = [];
    for (const rule of depthGutters) {
      const value =
        cssDeclarations(rule.body).find((d) => d.prop === "--list-gutter")
          ?.value ?? "";
      if (!value.includes("ch")) offenders.push(`${where(rule)} — not in ch`);
      // 명시도 사다리의 두 발판. 둘 중 하나만 빠져도 규칙은 살아 있는 채로 진다.
      if (!rule.selector.includes(".tiptap.tiptap"))
        offenders.push(`${where(rule)} — .tiptap 이 한 번뿐이다`);
      if (!rule.selector.includes("[start]"))
        offenders.push(`${where(rule)} — [start] 변형이 없다`);
    }
    expect(offenders).toEqual([]);

    // 십진 규칙 **전부**보다 뒤에 있어야 한다. 하나라도 뒤에 있으면 그 하나가 이긴다.
    const digitGutters = LIST_RULES.filter(
      (rule) =>
        /\bol\b/u.test(rule.selector) &&
        !/ol\s+ol/u.test(rule.selector) &&
        cssDeclarations(rule.body).some((d) => d.prop === "--list-gutter"),
    );
    expect(digitGutters.length).toBeGreaterThan(0);
    const lastDigit = Math.max(...digitGutters.map((r) => r.index));
    const firstDepth = Math.min(...depthGutters.map((r) => r.index));
    expect(digitGutters.every((r) => r.file === depthGutters[0].file)).toBe(
      true,
    );
    expect(firstDepth).toBeGreaterThan(lastDigit);
  });

  it("steps the roman reserve where roman numerals actually get longer", () => {
    // 예약 폭 자체는 실측이고 CSS 주석이 코퍼스와 함께 싣는다. 여기서 고정하는 것은
    // **문턱**이다 — 문턱은 서체가 아니라 로마 숫자의 성질이라 여기서 계산할 수 있고,
    // 계산할 수 있는 것을 상수로 베껴 두면 다음 사람이 그 근거를 잃는다.
    //
    // 무엇이 이것을 실패시키는가: 문턱을 옮기면(예: 18 → 20) 18~19개짜리 리스트가
    // `xviii.` 를 좁은 상자에 넣게 되고, 그 마커만 상자를 넘겨 정렬이 깨진다 — 앱에서
    // 보고된 바로 그 증상이다. 예약이 단조롭지 않아도 red 다: 뒤 구간이 앞 구간보다
    // 좁으면 더 긴 마커가 더 좁은 상자를 받는다.
    const roman = (n: number): string => {
      const table: readonly [number, string][] = [
        [10, "x"],
        [9, "ix"],
        [5, "v"],
        [4, "iv"],
        [1, "i"],
      ];
      let rest = n;
      let out = "";
      for (const [value, glyph] of table)
        while (rest >= value) {
          out += glyph;
          rest -= value;
        }
      return out;
    };
    // 길이가 **늘어나는** 자리. 1..37 에서 8·18·28 이고, 38 은 CSS 가 의도적으로
    // 덮지 않는 구간이라(주석에 적혀 있다) 여기서도 기대에서 뺀다.
    const steps: number[] = [];
    for (let n = 2; n <= 37; n += 1)
      if (
        roman(n).length >
        Math.max(...[...Array(n - 1)].map((_, i) => roman(i + 1).length))
      )
        steps.push(n);
    expect(steps).toEqual([2, 3, 8, 18, 28]);

    const tiers = LIST_RULES.filter(
      (rule) =>
        /ol\s+ol\s+ol/u.test(rule.selector) &&
        /nth-child/u.test(rule.selector) &&
        cssDeclarations(rule.body).some((d) => d.prop === "--list-gutter"),
    ).map((rule) => ({
      reserve: Number(
        /calc\(\s*([\d.]+)ch/u.exec(
          cssDeclarations(rule.body).find((d) => d.prop === "--list-gutter")
            ?.value ?? "",
        )?.[1],
      ),
      threshold: Number(/nth-child\((\d+)\)/u.exec(rule.selector)?.[1]),
      where: where(rule),
    }));
    // 2·3 은 한 자리 거터가 이미 덮는 구간이라(`iii.` 는 바닥 안이다) 구간을 두지 않는다.
    expect(tiers.map((t) => t.threshold)).toEqual([8, 18, 28]);
    for (let i = 1; i < tiers.length; i += 1)
      expect(tiers[i].reserve, tiers[i].where).toBeGreaterThan(
        tiers[i - 1].reserve,
      );
  });

  it("hands the one-digit gutter back to a list that cannot reach two digits", () => {
    // `[start]` 는 값을 숫자로 읽을 수 없으니 "두 자리에 닿는다" 를 **항목 수**로
    // 되묻는다: s 에서 시작한 리스트는 (11 − s) 번째 항목에서 10 에 닿는다. 그
    // 대응이 어긋나면 조용히 틀린다 — 문턱이 낮으면 아직 한 자리인 리스트가 두
    // 자리 거터를 쓰고(번호와 본문 사이가 벌어진다), 높으면 두 자리에 닿은
    // 리스트가 한 자리 거터를 받아 마커가 상자를 넘겨 정렬을 잃는다.
    //
    // 무엇이 이것을 실패시키는가: 문턱 하나를 ±1 하거나, 리셋 규칙을 넓히는 규칙
    // **앞으로** 옮기면 red 다.
    const resets = LIST_RULES.filter(
      (rule) =>
        rule.selector.includes(":not(:has(") &&
        cssDeclarations(rule.body).some((d) => d.prop === "--list-gutter"),
    );
    expect(resets).toHaveLength(1);
    const reset = resets[0];

    const pairs = [
      ...reset.selector.matchAll(
        /\[start="(\d)"\]:not\(:has\(>\s*li:nth-child\((\d+)\)\)\)/gu,
      ),
    ].map(([, start, threshold]) => [Number(start), Number(threshold)]);
    // 한 자리 시작값 전부. 1 은 `[start]` 가 아예 붙지 않는 값이라 제외한다.
    expect(pairs.map(([start]) => start)).toEqual([0, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const [start, threshold] of pairs) {
      expect(threshold, `start=${start}`).toBe(11 - start);
    }

    const widening = LIST_RULES.filter(
      (rule) =>
        rule.selector.includes("[start]") &&
        !/ol\s+ol/u.test(rule.selector) &&
        cssDeclarations(rule.body).some((d) => d.prop === "--list-gutter"),
    );
    expect(widening.length).toBeGreaterThan(0);
    expect(reset.index).toBeGreaterThan(
      Math.min(...widening.map((r) => r.index)),
    );
  });

  it("lets padding grow the ordered marker's box, not eat its glyph column", () => {
    // Tailwind preflight 은 모든 상자를 `border-box` 로 만든다. 바닥(`min-width`)과
    // padding 이 함께 있으면 그 조합에서 padding 은 바닥이 잡아 둔 **글자 열에서**
    // 나오고, `left` 정렬은 글자를 padding 안쪽 모서리에 놓으므로 padding 이 숫자를
    // 민다. 마커 뒤에 무언가를 칠하려고 padding 을 쓰는 코드는 실재한다 — 번들된
    // `bullet-threading` 예제가 커서가 있는 항목에 `padding-left: 0.3em` 을 건다.
    //
    // 무엇이 이것을 실패시키는가: 이 선언을 지우면 그 예제를 켠 사용자의 커서 항목만
    // 번호가 오른쪽으로 밀린다(실측 4.83px @18px, 고친 뒤 0.56px). 반대로 글머리 기호
    // 쪽에 같은 선언이 붙어도 red 다 — 깊이 2 의 링은 `border-box` 라야 바깥 지름이
    // 원의 지름과 같다(이 파일 마커 절 주석).
    const ordered = LIST_RULES.find(
      (rule) =>
        rule.selector.replaceAll(/\s+/gu, " ") === ".tiptap ol > li::before",
    );
    expect(ordered).toBeDefined();
    expect(
      cssDeclarations(ordered?.body ?? "").find((d) => d.prop === "box-sizing")
        ?.value,
    ).toBe("content-box");

    const bulletSide = LIST_RULES.filter(
      (rule) =>
        /\bul\b/u.test(rule.selector) &&
        /li::before/u.test(rule.selector) &&
        cssDeclarations(rule.body).some((d) => d.prop === "box-sizing"),
    ).map(where);
    expect(bulletSide).toEqual([]);
  });

  it("hangs the indent guide in the parent's marker gutter", () => {
    // The structural half of "the rail descends from the parent's bullet": whatever the
    // tuned offset is, it has to be NEGATIVE — a guide at `left: 0` sits at the parent's
    // text column, which is where this started and what the reference design rejected.
    // The exact -1em is left free to tune; the side of the list it falls on is not.
    // The guide is a `::before` on the nested LIST. Matching `li::before` instead picks up
    // the marker rules, which are anchored with `right: 100%` and have no `left` at all —
    // a first version of this test reported them as guides on the wrong side.
    const guides = LIST_RULES.filter((rule) =>
      selectorParts(rule.selector).some(
        (part) =>
          /\bli\b/u.test(part) &&
          /^(?:ul|ol)::before$/u.test(selectorTarget(part)),
      ),
    );
    const offsets = guides.map((rule) => ({
      left: cssDeclarations(rule.body).find((d) => d.prop === "left")?.value,
      rule,
    }));
    expect(offsets.length).toBeGreaterThan(0);
    const wrongSide = offsets
      .filter(({ left }) => left === undefined || !left.startsWith("-"))
      .map(({ rule }) => where(rule));
    expect(wrongSide).toEqual([]);
  });

  it("mixes the indent guide from a theme key and the user's strength dial", () => {
    // §369 — 가이드는 두 축으로 열려 있고, 이 테스트는 그 둘이 실제로 선언에
    // 도달하는지를 본다. 무엇이 이것을 실패시키는가, 셋이다.
    //
    // ① 색조가 `--color-editor-guide-tint` 가 아니면 테마는 가이드에 닿지 못한다.
    //    테마가 색을 싣는 통로는 `THEME_COLOR_KEYS` → `applyThemeVars` 의 `<html>`
    //    인라인 하나뿐이다(테마 패키지 CSS 는 `@layer baram-theme` 안이고
    //    `sanitize.ts` 가 `!important` 를 뗀다). 그래서 `--color-editor-text` 를
    //    직접 읽는 선언으로 되돌리면 그 통로가 사라진다 — 두 변수 모두 오늘
    //    같은 색으로 해석되므로 **화면으로는 구별되지 않는** 회귀다.
    //
    // ② fallback 과 다이얼 기본값이 갈리면, 사용자가 슬라이더를 처음 건드리는
    //    순간 화면이 튄다(기본 출처인 다이얼은 변수를 쓰지 않으므로 — `apply.ts` —
    //    건드리기 전까지는 fallback 이 지배한다). 한쪽만 고치는 것을 막으려고
    //    두 파일을 여기서 함께 읽는다.
    //
    // ③ 농도 변수를 아예 읽지 않으면 다이얼이 조용히 무의미해진다.
    const guides = LIST_RULES.filter((rule) =>
      selectorParts(rule.selector).some(
        (part) =>
          /\bli\b/u.test(part) &&
          /^(?:ul|ol)::before$/u.test(selectorTarget(part)),
      ),
    );
    expect(guides.length).toBeGreaterThan(0);

    const dial = DIALS.find((d) => d.id === "editorListGuideStrength");
    expect(dial).toBeDefined();

    const offenders: string[] = [];
    for (const rule of guides) {
      const background = cssDeclarations(rule.body).find(
        (d) => d.prop === "background",
      )?.value;
      if (background === undefined) {
        offenders.push(`${where(rule)} — no background`);
        continue;
      }
      if (!background.includes("var(--color-editor-guide-tint)")) {
        offenders.push(`${where(rule)} — tint is not the theme key`);
      }
      const fallback =
        /var\(\s*--editor-guide-strength\s*,\s*(\d+)%\s*\)/u.exec(background);
      if (fallback === null) {
        offenders.push(`${where(rule)} — no strength var with a % fallback`);
      } else if (Number(fallback[1]) !== dial?.defaultValue) {
        offenders.push(
          `${where(rule)} — fallback ${fallback[1]}% != dial default ${String(dial?.defaultValue)}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it("derives every vertical placement from the line height setting", () => {
    // `lineHeight` is a user setting applied inline to `.tiptap`, so anything absolutely
    // positioned onto a line box has to read it rather than assume 1.75.
    //
    // Named, not counted. A `length >= 2` version of this passed with any ONE of the
    // three sites reverted to a constant, which is exactly the regression it exists to
    // catch — and the three have to agree with each other, not merely exist: the arrow
    // points at the marker, and the checkbox shares the marker's column.
    const CENTRED_ON_A_LINE_BOX = [
      ".tiptap ul > li::before", // drawn bullet
      "> .task-checkbox", // task checkbox (a <button> since §18.18 M4)
      ".tiptap li > .fold-arrow", // fold arrow
    ];
    const missing = CENTRED_ON_A_LINE_BOX.filter(
      (selector) =>
        !LIST_RULES.some(
          (rule) =>
            rule.selector.includes(selector) &&
            rule.body.includes("--editor-line-height"),
        ),
    );
    expect(missing).toEqual([]);
  });
});

describe("list colours", () => {
  // The only colours that follow a theme are the ones a theme sets, plus the ones
  // `theme-vars.ts` derives from those. Anything else is frozen at its stylesheet
  // value the moment the user leaves the default themes.
  const THEME_SAFE = new Set<string>([
    ...THEME_COLOR_KEYS.map(({ key }) => key),
    ...DERIVED_KEYS,
  ]);

  it("knows what the themes actually override", () => {
    // Guards the guard: an empty or truncated set would make the check below vacuous.
    expect(THEME_SAFE.size).toBeGreaterThanOrEqual(30);
    expect(THEME_SAFE.has("--color-editor-text")).toBe(true);
    expect(THEME_SAFE.has("--color-text-muted")).toBe(false);
  });

  it("names only tokens every theme overrides", () => {
    const offenders = LIST_RULES.flatMap((rule) =>
      cssDeclarations(rule.body)
        .filter((declaration) =>
          /(?:^|-)(?:color|background)$/u.test(declaration.prop),
        )
        .flatMap((declaration) =>
          [...declaration.value.matchAll(/var\(\s*(--color-[\w-]+)/gu)]
            .map((match) => match[1])
            .filter((token) => !THEME_SAFE.has(token))
            .map((token) => `${where(rule)} { ${declaration.prop}: ${token} }`),
        ),
    );
    expect(offenders).toEqual([]);
  });
});
