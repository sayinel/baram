// §5.12 export — the exported stylesheet IS the editor's, rescoped.
//
// Two halves, and they fail differently:
//
//   - `rescopeEditorCSS` runs regexes over CSS other people wrote. The fixtures
//     below are the shapes those regexes could plausibly mangle, not the shapes
//     they obviously handle.
//   - The shipped stylesheet is then asserted through jsdom's CASCADE, not by
//     grepping for rule text. A substring match proves a rule was written; it
//     does not prove the rule reaches the element or wins over another one. The
//     user's report was about how the page LOOKS, so the assertions are about
//     computed values.
//
// ‼️ jsdom 31.0.0 substitutes `var()` (30.1.3 did not), so a token-valued
// property computes to a real colour. A reference that resolves to nothing
// does not show up as an empty string, though: the declaration is invalid at
// computed-value time and the property falls back to its inherited or initial
// value — `border-left-color` to `currentcolor`. So a token-valued check here
// compares against a value the bundled sheet itself defines, never just
// "is a colour".
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import editorCSS from "../../../styles/editor.css?raw";
import {
  DROPPED_PROPERTIES,
  editorContentCSS,
  rescopeEditorCSS,
} from "../export-editor-css";
import { buildExportStylesheet } from "../export-html-styles";

describe("rescopeEditorCSS", () => {
  it("moves .tiptap-scoped rules onto the export wrapper", () => {
    expect(rescopeEditorCSS(".tiptap h1 { font-size: 2em; }")).toContain(
      "article.baram-export h1",
    );
  });

  it("drops `contain` without touching `content`", () => {
    // ‼️ The pair that matters. A property-name regex that is not anchored to a
    // declaration boundary eats `content:` too — and `content` is what draws
    // every list marker and the toggle arrow, so getting this wrong deletes
    // exactly the styling this change exists to restore.
    const out = rescopeEditorCSS(
      ".tiptap li::before { contain: layout paint; content: counter(list-item) '.'; }",
    );
    expect(out).not.toContain("contain:");
    expect(out).toContain("content: counter(list-item)");
  });

  it("drops the longer contain-* properties, not just the prefix", () => {
    const out = rescopeEditorCSS(
      ".tiptap tr { contain-intrinsic-height: 40px; content-visibility: auto; color: red; }",
    );
    expect(out).not.toContain("contain-intrinsic-height");
    expect(out).not.toContain("content-visibility");
    expect(out).toContain("color: red");
  });

  it("keeps a declaration whose name merely ends with a dropped one", () => {
    const out = rescopeEditorCSS(
      ".tiptap p { -webkit-will-change: transform; }",
    );
    expect(out).toContain("-webkit-will-change");
  });

  it("keeps `cursor`, which is inert in print and can carry a url()", () => {
    // ‼️ Deliberately NOT dropped. The value pattern cannot see quotes, so a
    // `url("a;b.png")` would be cut at the semicolon inside the string.
    const out = rescopeEditorCSS(
      '.tiptap a { cursor: url("a;b.png"), pointer; color: red; }',
    );
    expect(out).toContain('url("a;b.png")');
    expect(out).toContain("color: red");
  });

  it("strips comments, including ones naming .tiptap", () => {
    const out = rescopeEditorCSS(
      "/* .tiptap notes */\n.tiptap p { margin: 0; }",
    );
    expect(out).not.toContain("notes");
    expect(out).toContain("article.baram-export p");
  });

  it("leaves no dropped declaration in the shipped stylesheet but the export's own containment", () => {
    // ‼️ This is the assertion that caught the real bug, and the per-fixture
    // checks above are not a substitute for it: the single `/g` pass handled
    // every fixture correctly and still shipped `content-visibility: auto`,
    // because a rule once had two dropped declarations back to back and the
    // first match ate the separator the second one needed. That case (editor/
    // tables.css's since-removed `tr.baram-vscroll` rule) is now covered by the
    // synthetic fixture above ("drops the longer contain-* properties, not
    // just the prefix"), but only a sweep of the WHOLE output can see this
    // class of bug in general.
    // §394 spec 0073 D12 — the two `.plugin-block-export` rules in
    // EXPORT_BASE_CSS restate a plugin-rendered block's containment on purpose
    // (export-html-styles.ts). They are cut out by their selectors, and counted,
    // so a dropped declaration anywhere else in the sheet still fails this.
    const shipped = buildExportStylesheet();
    const ownContainment = /^\.plugin-block-export(?:-host)? \{[^}]*\}$/gm;
    expect(shipped.match(ownContainment)).toHaveLength(2);
    const css = shipped.replace(ownContainment, "");
    // Iterating the list itself, so a property added to it later cannot be
    // dropped in production and left unswept here.
    expect(DROPPED_PROPERTIES.length).toBeGreaterThan(0);
    for (const prop of DROPPED_PROPERTIES) {
      expect(css).not.toContain(`${prop}:`);
    }
    // …and the property whose name merely starts the same way must survive.
    expect(css).toContain("content:");
  });

  it("is not vacuous — the real editor CSS actually loaded", () => {
    // vitest stubs CSS imports with "" unless `test.css` is on. Without this,
    // every cascade assertion below would run against an empty sheet.
    expect(editorContentCSS().length).toBeGreaterThan(10_000);
    // No trailing space: `.tiptap>`, `.tiptap:` and `.tiptap,` would all slip
    // past a space-qualified check.
    expect(editorContentCSS()).not.toContain(".tiptap");
  });

  it("carries the mask icons the exported toggle arrow draws with", () => {
    // 무엇이 이것을 실패시키는가: EDITOR_STYLESHEETS 에서 iconsCSS 를 빼면 둘째 단정이
    // red 다. 첫 단정은 그 변수를 쓰는 규칙이 실제로 export 에 있다는 짝이다.
    const css = editorContentCSS();
    expect(css).toMatch(
      /\.toggle::before\s*\{[^}]*var\(--icon-chevron-right\)/u,
    );
    expect(css).toContain("--icon-chevron-right: url(");
  });
});

describe("what the exported page actually looks like", () => {
  let style: HTMLStyleElement;

  beforeAll(() => {
    style = document.createElement("style");
    style.textContent = buildExportStylesheet();
    document.head.append(style);
  });

  afterAll(() => {
    style.remove();
    document.body.innerHTML = "";
  });

  function mount(html: string): HTMLElement {
    document.body.innerHTML = `<article class="baram-export">${html}</article>`;
    return document.body.firstElementChild as HTMLElement;
  }

  it("puts a callout's icon, title and nothing else on one line", () => {
    // The user's words: "경고 아이콘과 'Info' 등의 제목이 한 줄에 있어야 함".
    // The export used to ship a single `.callout` rule and no `.callout-header`
    // rule at all, so the header was a block and the icon sat above the title.
    const el = mount(
      `<div class="callout callout-info"><div class="callout-header">
         <div class="callout-icon-wrapper"><span class="callout-icon-btn"></span></div>
         <span class="callout-title">Info</span>
       </div><div class="callout-body"><p>body</p></div></div>`,
    ).querySelector(".callout-header") as HTMLElement;

    expect(getComputedStyle(el).display).toBe("flex");
    expect(getComputedStyle(el).alignItems).toBe("center");
  });

  it("gives each callout type its own colour", () => {
    // Discriminating: one generic `.callout` rule — which is what shipped
    // before — paints tip and bug identically.
    //
    // 기대값은 번들 시트의 글에서 나온다 — 13개 타입 전부의 토큰을 참조
    // 사슬(semantic → primitive)대로 따라가 hex에 닿게 하고, jsdom의 cascade가
    // 그 타입 callout에 계산한 테두리 색이 바로 그 hex여야 한다. 계산값만으로는
    // 판정하지 못한다: 사슬이 허공을 가리키면 테두리는 `currentcolor`로
    // 계산돼(31.0.0 실측) 여전히 "색"이다. (danger/failure처럼 같은 primitive를
    // 공유하는 쌍은 의도된 설계라 pairwise-distinct는 걸지 않는다.)
    const borderOf = (type: string): string =>
      getComputedStyle(
        mount(`<div class="callout callout-${type}"></div>`)
          .firstElementChild as HTMLElement,
      ).borderLeftColor;
    expect(borderOf("bug")).not.toBe(borderOf("tip"));

    const sheet = buildExportStylesheet();
    const resolve = (name: string, depth = 0): string => {
      expect(depth, `${name} 참조가 너무 깊다(순환?)`).toBeLessThan(5);
      const def = new RegExp(`${name}:\\s*([^;]+);`).exec(sheet);
      expect(def, `${name}이 번들 시트에 정의돼 있지 않다`).not.toBeNull();
      const value = def![1].trim();
      const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
      return ref ? resolve(ref[1], depth + 1) : value;
    };
    const TYPES = [
      "abstract",
      "bug",
      "danger",
      "example",
      "failure",
      "info",
      "note",
      "question",
      "quote",
      "success",
      "tip",
      "todo",
      "warning",
    ];
    /** `#10b981` → `rgb(16, 185, 129)`, the form jsdom serializes an opaque colour in. */
    const rgb = (hex: string): string => {
      const digits = hex.slice(1);
      const pairs =
        digits.length === 3
          ? [...digits].map((d) => d + d)
          : (digits.match(/../g) ?? []);
      return `rgb(${pairs.map((pair) => parseInt(pair, 16)).join(", ")})`;
    };
    for (const type of TYPES) {
      const hex = resolve(`--color-callout-${type}`);
      expect(hex).toMatch(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);
      expect(borderOf(type), type).toBe(rgb(hex));
    }
  });

  // tip의 배경은 `color-mix(in srgb, var(--color-callout-tip) 8%, transparent)`,
  // var()가 든 `background` 단축 속성이다. 31.0.0의 cascade는 이것을 실색으로
  // 계산하므로(실측) 출하된 시트를 그대로 읽는다 — 30.1.2·30.1.3은 그 배경을
  // 투명으로 읽어서, tip 토큰 참조를 리터럴로 바꿔 끼워야 구별이 됐다.
  function tipBackground(theme?: "dark", extraCSS = ""): string {
    const shipped = style.textContent;
    style.textContent = shipped + extraCSS;
    if (theme) document.documentElement.dataset.theme = theme;
    try {
      const tip = mount(`<div class="callout callout-tip"></div>`)
        .firstElementChild as HTMLElement;
      return getComputedStyle(tip).backgroundColor;
    } finally {
      delete document.documentElement.dataset.theme;
      style.textContent = shipped;
    }
  }

  it("keeps dark mode from repainting typed callout backgrounds", () => {
    // 회귀 핀 (적대 리뷰 2회): `[data-theme="dark"] … .callout { background }`
    // 류의 일반 다크 규칙은 (0,3,0)이라 타입 규칙 (0,2,0)을 전부 이긴다 —
    // 명시적 다크 테마에서만 13개 타입 배경이 한 색으로 뭉개지는 결함이 실제로
    // 있었다. 정규식 핀은 표기(인용부호·:where()·selector list)에 속았으므로,
    // 다크 root 아래 타입 callout을 실제로 마운트해 계산된 배경이 라이트와
    // 같은 규칙에서 오는지를 본다. 인용부호·:where()·:is()·selector list·
    // !important·`@media screen` 안의 규칙·CSS 중첩 규칙으로 다시 들어와도
    // cascade 결과로 잡힌다(31.0.0 실측 — 30.1.3의 cascade는 중첩 규칙으로 내려가지
    // 않아 이 핀이 그것만은 보지 못했다). tip만 마운트하므로 다크 override는 일반
    // `.callout` 규칙과 tip 규칙만 걸린다 — 다른 타입의 override는 보지 못한다
    // (blocks.css에는 어느 쪽도 없다).
    const light = tipBackground();
    // 짝: 라이트 배경이 실색으로 계산되지 않고 투명으로 남으면 아래 비교는
    // 투명 = 투명이 된다.
    expect(light).not.toBe("rgba(0, 0, 0, 0)");
    expect(tipBackground("dark")).toBe(light);
  });

  it("CONTROL: a generic dark `.callout` background rule would repaint it", () => {
    const generic = `[data-theme="dark"] article.baram-export .callout { background: var(--color-bg-subtle); }`;
    expect(tipBackground("dark", generic)).not.toBe(tipBackground());
  });

  // §308 — the chip and the raw text it renders BOTH reach the export, and the
  // stylesheet is the only thing that decides which one the reader sees. The
  // markup half of this is pinned in export-heavy-blocks.test.tsx; without
  // these two rules the page prints the field twice — once as `8/29 due`, once
  // as raw `📅2026-08-29` — and nothing in the DOM would look wrong.
  it("hides the raw text a task chip stands in for", () => {
    const raw = mount(
      `<p><span class="task-field-raw visually-hidden">📅2026-08-29</span></p>`,
    ).querySelector(".task-field-raw") as HTMLElement;

    expect(getComputedStyle(raw).width).toBe("1px");
    expect(getComputedStyle(raw).overflow).toBe("hidden");
  });

  it("styles the chip that replaced it", () => {
    const chip = mount(
      `<p><span class="task-chip">8/29 due</span></p>`,
    ).querySelector(".task-chip") as HTMLElement;

    expect(getComputedStyle(chip).display).toBe("inline-flex");
    // ‼️ Not `--color-text-muted`. That token is the disabled alias and its
    // measured contrast (2.54:1 light) fails AA at this size — and the chip is
    // the ONLY visual form of this metadata, since the raw text is hidden.
    expect(getComputedStyle(chip).color).not.toBe("");
  });

  it("uses the editor's drawn list markers, not the browser's glyphs", () => {
    // §5.1 lists draw every marker with `::before` and set `list-style: none`
    // (lists.css). The export used to declare `list-style-type: disc`, which is
    // the system this one deliberately replaced — so the two disagreed at every
    // nesting depth.
    const ul = mount("<ul><li><p>x</p></li></ul>")
      .firstElementChild as HTMLElement;
    expect(getComputedStyle(ul).listStyle).toContain("none");
  });

  it("positions list items, so the absolutely-placed markers have an anchor", () => {
    // ‼️ Without this the markers all pile up against the page instead of
    // sitting in their gutters — `right: 100%` resolves against the nearest
    // positioned ancestor, and lists.css does not set it on `li` itself
    // (editor/base.css does, and base.css is deliberately not imported).
    const li = mount("<ul><li><p>x</p></li></ul>").querySelector(
      "li",
    ) as HTMLElement;
    expect(getComputedStyle(li).position).toBe("relative");
  });

  describe("a journal-photos block", () => {
    /** 이것을 실패시키는 것: `EDITOR_STYLESHEETS` 에서 `journalPhotosCSS` 를 빼는 것 — 4열 격자가
     *  한 줄에 한 장씩 큰 사진으로 쌓이고, 읽지 못한 사진의 이름은 스타일이 없다. */
    it("keeps the layout it has on screen", () => {
      const grid = mount(
        '<div class="journal-photos-grid"><div class="journal-photos-cell"><img class="journal-photos-thumb"></div><div class="journal-photos-cell"><span class="journal-photos-missing">a.jpg</span></div></div>',
      ).firstElementChild as HTMLElement;
      expect(getComputedStyle(grid).display).toBe("grid");
      expect(
        getComputedStyle(grid.querySelector("img")!).getPropertyValue(
          "object-fit",
        ),
      ).toBe("cover");
      expect(getComputedStyle(grid.querySelector("span")!).display).toBe(
        "flex",
      );
    });

    /** The sheet has two readers, the export above and the app. 이것을 실패시키는 것:
     *  `editor.css` 의 `@import` 를 지우는 것 — 이 파일의 다른 시험은 모두 통과한 채 화면의 격자만
     *  사라진다. */
    it("is also the sheet the app loads", () => {
      expect(editorCSS).toContain('@import "./editor/journal-photos.css"');
    });

    /** 이것을 실패시키는 것: `.journal-photos-strip` 규칙을 지우는 것 — 칸이 한 줄이 아니라 한
     *  칸 폭의 세로 줄로 쌓인다. */
    it("keeps a strip on one row on screen", () => {
      const strip = mount('<div class="journal-photos-strip"></div>')
        .firstElementChild as HTMLElement;
      expect(getComputedStyle(strip).getPropertyValue("grid-auto-flow")).toBe(
        "column",
      );
    });

    /** A PDF cannot scroll, and jsdom's cascade skips `@media print`, so the rules are read
     *  from the parsed sheet. What they do was measured in Chrome, not here: without them a
     *  strip of 40 photos printed 8 whole cells and cut the rest at the page's edge, and a
     *  row of name-only cells split across two pages.
     *  이것을 실패시키는 것: `journal-photos.css` 의 print 규칙을 지우는 것. */
    it("wraps a strip into rows and keeps cells whole in a PDF", () => {
      const printRules = [...style.sheet!.cssRules]
        .filter((rule) =>
          (rule as CSSMediaRule).media?.mediaText.includes("print"),
        )
        .flatMap((rule) => [...(rule as CSSMediaRule).cssRules])
        .map((rule) => rule as CSSStyleRule);
      const printed = (selector: string, property: string) =>
        printRules
          .filter((rule) => rule.selectorText === selector)
          .map((rule) => rule.style.getPropertyValue(property))
          .find(Boolean);

      expect(printed(".journal-photos-strip", "grid-auto-flow")).toBe("row");
      // A row of name-only cells has no image to keep it whole: Chrome split one across
      // two pages without this.
      expect(printed(".journal-photos-cell", "break-inside")).toBe("avoid");
      expect(printed(".journal-photos-strip", "grid-template-columns")).toBe(
        "repeat(auto-fill, 80px)",
      );
    });
  });

  it("gives a toggle its disclosure arrow's room", () => {
    // The exported stylesheet knew only `details summary`, and the toggle node
    // renders a `div.toggle` — so every rule for it was dead and a toggle
    // printed as two bare paragraphs.
    const el = mount('<div class="toggle" data-open="true"><p>h</p></div>')
      .firstElementChild as HTMLElement;
    expect(getComputedStyle(el).position).toBe("relative");
    expect(parseFloat(getComputedStyle(el).paddingLeft)).toBeGreaterThan(0);
  });
});
