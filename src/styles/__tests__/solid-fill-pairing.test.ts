// §54 / #330 — a solid accent or status surface may not name its own foreground.
//
// The bug this prevents was written 80 times for the accent and 13 more for the
// status families: `background: var(--color-accent-*)` or `var(--color-status-*)`
// beside `color: white`. Any single one of those is invisible in review, and
// `npm run audit:css-vars` cannot see it — it only reports *undefined* variables.
// So the rule is asserted over the whole stylesheet rather than site by site: the
// next filled button inherits the fix instead of re-introducing the bug.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  cssRules,
  innermostObjects,
  objectProperty,
  selectorParts,
  walk,
} from "./css-rules";

const SRC = "src";

/** Solid accent fill — `color-mix(...)` tints are excluded on purpose. */
const SOLID_ACCENT_BG =
  /background(?:-color)?\s*:\s*var\(\s*--color-accent-(default|hover|solid|solid-hover)\b/;
const HARDCODED_LIGHT_FG =
  /(?<!-)\bcolor\s*:\s*(white|#fff|#ffffff)\s*(?:;|$)/i;
const ON_SOLID_FG = /(?<!-)\bcolor\s*:\s*var\(\s*--color-accent-on-solid\s*\)/;

const RULES = cssRules();
const ACCENT_FILLED = RULES.filter((rule) => SOLID_ACCENT_BG.test(rule.body));

describe("solid accent surfaces in CSS", () => {
  it("scanned enough of the stylesheet to be meaningful", () => {
    // Without this, a broken regex would make every assertion below vacuous.
    expect(RULES.length).toBeGreaterThan(1000);
    expect(ACCENT_FILLED.length).toBeGreaterThanOrEqual(80);
  });

  it("never hardcodes a light foreground", () => {
    const offenders = ACCENT_FILLED.filter((rule) =>
      HARDCODED_LIGHT_FG.test(rule.body),
    ).map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("uses accent-on-solid wherever a filled accent surface sets a colour", () => {
    // A filled accent surface that names any other foreground is either a bug or
    // a colour that has not been checked against every theme's accent.
    const offenders = ACCENT_FILLED.filter(
      (rule) =>
        /(?<!-)\bcolor\s*:/.test(rule.body) && !ON_SOLID_FG.test(rule.body),
    ).map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("keeps accent-default for surfaces that carry no text", () => {
    // Dots, drop indicators and resize handles want the bright accent, not the
    // text-bearing fill — they have no foreground to contrast with.
    //
    // Named rather than counted. An earlier version asserted only `length > 0`,
    // which would have stayed green with 15 of the 16 wrongly converted — it
    // proved the category was non-empty, not that these surfaces survived.
    const stillBright = new Set(
      RULES.filter((rule) =>
        /background(?:-color)?\s*:\s*var\(\s*--color-accent-default\b/.test(
          rule.body,
        ),
      ).map((rule) => rule.selector),
    );
    const expected = [
      '.contribution-heatmap-cell[data-level="4"]',
      ".activity-bar-btn-active::before",
      ".calendar-dot-filled",
      ".drop-indicator-bar",
      ".drop-indicator-bar::before",
      ".graph-settings-toggle.on",
      ".media-resize-handle::before",
      ".plugin-consent__cap::before",
      ".settings-toggle-on",
      ".splitter:hover",
      ".status-git-dot",
      ".tab-drop-indicator-end",
      ".table-drop-indicator",
      ".table-grid-cell-active",
      ".tiptap .column-resize-handle",
      ".update-dialog-progress-fill",
    ];
    expect(expected.filter((selector) => !stillBright.has(selector))).toEqual(
      [],
    );
  });
});

describe("solid status surfaces in CSS", () => {
  // Same defect, different token family, and worse: white on `--color-status-warning`
  // measures 2.15:1 and on `--color-status-success` 2.54:1 — under even the 3:1
  // non-text floor, and unlike the accent these values do not vary by theme, so
  // every user saw them.
  const STATUS_FILL =
    /background(?:-color)?\s*:\s*var\(\s*--color-status-(danger|warning|success)\b/;
  const statusFilled = RULES.filter((rule) => STATUS_FILL.test(rule.body));

  it("scanned the status-filled rules", () => {
    expect(statusFilled.length).toBeGreaterThanOrEqual(10);
  });

  it("never hardcodes a light foreground", () => {
    const offenders = statusFilled
      .filter((rule) => HARDCODED_LIGHT_FG.test(rule.body))
      .map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("names the matching on-solid token when it sets a foreground", () => {
    // A filled danger surface must use the danger foreground, not the warning one:
    // the families are user-editable independently, so a mismatched pair is a
    // pairing nothing has checked.
    const offenders = statusFilled
      .filter((rule) => /(?<!-)\bcolor\s*:/.test(rule.body))
      .filter((rule) => {
        // Last declaration wins in CSS, so the effective fill is the last match.
        const family = [
          ...rule.body.matchAll(new RegExp(STATUS_FILL.source, "g")),
        ].at(-1)?.[1];
        return !new RegExp(
          `(?<!-)\\bcolor\\s*:\\s*var\\(\\s*--color-status-${family}-on-solid\\s*(?:,[^)]*)?\\)`,
        ).test(rule.body);
      })
      .map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });
});

describe("hardcoded light foregrounds anywhere in CSS", () => {
  // Rule-scoped checks cannot see the shape that `.skill-lint-badge` had: `color:
  // white` on a base class while the fills lived on its modifiers. That defect was
  // found by reading components, not by a guard. Inverting the question closes it —
  // a hardcoded light foreground is flagged wherever it appears, and the handful of
  // legitimate ones are named.
  const ALLOWED = new Set([
    // White on the photo lightbox's own dark scrim (rgb(0 0 0 / 60-92%)), not on a
    // theme colour, so no token applies.
    // 이 둘은 라이트박스가 아니라 **사진 자체** 위에 있다 — 배경이 테마 색이 아니라
    // 사용자의 사진이므로 어떤 토큰도 그 대비를 보장할 수 없다. 그래서 각자 자기
    // scrim을 깔고, 그 scrim의 최악 배경(순백 사진) 대비를 계산해 정해 두었다.
    ".photo-gallery-clip-badge",
    ".photo-gallery-item-caption",
    ".photo-lightbox-caption",
    ".photo-lightbox-close",
    ".photo-lightbox-nav",
    ".photo-lightbox-open-journal",
    ".photo-lightbox-view-original",
  ]);

  // ‼️ 판정은 **셀렉터 부분별로** 한다 — 예전에는 `rule.selector` 전체를 이름과 비교했다.
  // 두 동등한 버튼이 한 규칙을 공유하는 순간(`.a, .b { color: #fff }`) 그 비교는 어느
  // 이름과도 맞지 않아, 이미 승인된 색이 새 위반으로 잡히고 "not vacuous" 쪽은 승인된
  // 이름을 못 찾아 같이 깨졌다. 그룹 셀렉터는 정상적인 CSS이고, 그것을 표현할 수 없던
  // 것은 가드의 한계였다. selectorParts는 이 모듈이 이미 그 목적으로 제공한다.
  const litParts = (rule: { selector: string }) => selectorParts(rule.selector);

  it("has none outside the named exceptions", () => {
    const offenders = RULES.filter(
      (rule) =>
        HARDCODED_LIGHT_FG.test(rule.body) &&
        litParts(rule).some((part) => !ALLOWED.has(part)),
    ).map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("still finds the named exceptions, so the check is not vacuous", () => {
    // 이름 하나하나가 실제로 관측돼야 한다 — 규칙 수를 세면 그룹 하나가 두 이름을
    // 덮으면서 낡은 이름이 목록에 남아 있어도 통과한다.
    const observed = new Set(
      RULES.filter((rule) => HARDCODED_LIGHT_FG.test(rule.body)).flatMap(
        litParts,
      ),
    );
    expect([...ALLOWED].filter((name) => !observed.has(name))).toEqual([]);
  });
});

describe("hover fills on a solid surface", () => {
  it("are never a color-mix toward a hardcoded black or white", () => {
    // The direction has to come from whichever foreground the fill took. Mixing
    // toward black broke the themes whose danger takes dark text (4.21:1); mixing
    // toward white then broke Solarized, whose #dc322f takes white (3.83:1). A
    // constant cannot serve both, so a derived *-solid-hover token must be used.
    const offenders = RULES.filter((rule) =>
      /background(?:-color)?\s*:\s*color-mix\([^;]*var\(\s*--color-(?:accent|status)-[\w-]+\s*\)[^;]*,\s*(?:black|white|#000|#fff)/.test(
        rule.body,
      ),
    ).map((rule) => `${rule.file}:${rule.line} ${rule.selector}`);
    expect(offenders).toEqual([]);
  });
});

describe("solid accent surfaces in inline styles", () => {
  // This scan was originally rooted at `src/components` and matched only JSX
  // `style={{…}}` literals. Both narrowings hid a live defect: PluginMarketplace
  // kept its styles in a module-level `STYLES` constant (deleted by plan 0101) and
  // had zero JSX style literals, so an `accent-default` + `#fff` retry button sat
  // in the sweep's own directory, unseen, while this file reported green. It now
  // walks all of `src` and reads brace-matched objects, whatever syntax holds them.
  // 0101 이후 이 스캔이 찾는 채움은 없다 — 다음 인라인 채움이 생기면 아래 offender
  // 검사가 그것을 본다.

  /** 한 소스의 style 객체 중 배경·글자색을 가진 것. 코퍼스와 픽스처가 같이 쓴다. */
  const styleObjects = (file: string, source: string) =>
    innermostObjects(source)
      .filter((object) =>
        /(?<![-\w])(background(?:Color)?|color)\s*:/.test(object.body),
      )
      .map((object) => ({
        body: object.body,
        file,
        line: source.slice(0, object.start).split("\n").length,
      }));

  // Bound to the one property, not to the object. Scanning the whole object body
  // for an accent token flagged `backgroundColor: "transparent"` objects whose
  // *border* used the accent, and accent `color-mix()` tints whose text is meant to
  // be accent-coloured — neither is a filled surface.
  const isAccentFill = (object: { body: string }) => {
    const fill = objectProperty(object.body, /^background(Color)?$/);
    return (
      fill !== null &&
      fill.includes("--color-accent-") &&
      !fill.includes("color-mix")
    );
  };
  const isStatusFill = (object: { body: string }) => {
    const fill = objectProperty(object.body, /^background(Color)?$/);
    return fill !== null && fill.includes("--color-status-");
  };

  const objects = walk(SRC, ".tsx")
    .concat(walk(SRC, ".ts"))
    .filter((file) => !file.includes("__tests__"))
    .flatMap((file) => styleObjects(file, readFileSync(file, "utf8")));
  const accentObjects = objects.filter(isAccentFill);
  const statusObjects = objects.filter(isStatusFill);

  it("parsed style objects across the tree", () => {
    // A floor on the parse, not on the finding: if brace matching collapsed, every
    // assertion below would pass over an empty list. Deliberately not pinned to the
    // number of accent objects — that number is what a new defect would change.
    expect(objects.length).toBeGreaterThan(50);
  });

  it("fills from accent-solid, never from accent-default or accent-hover", () => {
    const offenders = accentObjects
      .filter((object) =>
        /--color-accent-(default|hover)\b/.test(
          objectProperty(object.body, /^background(Color)?$/) ?? "",
        ),
      )
      .map((object) => `${object.file}:${object.line}`);
    expect(offenders).toEqual([]);
  });

  // 0101 이 마켓플레이스를 스타일시트로 옮기면서 코퍼스의 인라인 채움은 0 이 됐다.
  // 옮긴 여덟 중 여섯(`--color-accent-solid` 채움 4 · `--color-status-warning` 채움 2)은
  // 위 "solid accent surfaces in CSS" · "solid status surfaces in CSS" 가 셀렉터로 본다.
  // 나머지 둘 — 오류 배너 `.plugin-detail__error` · `.plugin-card__error` 의
  // `var(--color-status-error-bg)` — 은 `STATUS_FILL` 이 `danger|warning|success` 만 잡아
  // 그 검사 밖이다. 인라인 쪽이 그 둘에 걸던 밝은 글자색 검사는 모든 규칙을 읽는
  // "hardcoded light foregrounds anywhere in CSS" 가 대신한다. 코퍼스의 개수로는
  // 매처가 살아 있는지 알 수 없으므로(빈 목록에서 아래 offender 검사는 전부 통과한다),
  // 같은 매처를 픽스처에 돌려 양성 대조로 삼는다. 무엇이 이것을 실패시키는가:
  // `objectProperty` 나 두 판정이 깨져 채움을 못 알아보게 되면.
  it("still recognises an inline accent fill and an inline status fill", () => {
    const fixture = [
      'const A = { backgroundColor: "var(--color-accent-solid)", color: "var(--color-accent-on-solid)" };',
      'const B = { backgroundColor: "var(--color-status-warning)", color: "var(--color-status-warning-on-solid)" };',
      'const C = { backgroundColor: "transparent", border: "1px solid var(--color-accent-default)", color: "red" };',
    ].join("\n");
    const found = styleObjects("fixture.tsx", fixture);
    expect(found).toHaveLength(3);
    expect(found.filter(isAccentFill)).toHaveLength(1);
    expect(found.filter(isStatusFill)).toHaveLength(1);
  });

  it("never hardcodes a light foreground on a status fill", () => {
    const offenders = statusObjects
      .filter((object) =>
        /^\s*"(#fff|#ffffff|white)"\s*$/i.test(
          objectProperty(object.body, /^color$/) ?? "",
        ),
      )
      .map((object) => `${object.file}:${object.line}`);
    expect(offenders).toEqual([]);
  });

  it("never hardcodes a light foreground in a style object", () => {
    const offenders = accentObjects
      .filter((object) =>
        /^\s*"(#fff|#ffffff|white)"\s*$/i.test(
          objectProperty(object.body, /^color$/) ?? "",
        ),
      )
      .map((object) => `${object.file}:${object.line}`);
    expect(offenders).toEqual([]);
  });
});
