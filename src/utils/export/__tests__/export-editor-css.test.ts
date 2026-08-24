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
// ‼️ jsdom does not substitute `var()`, so every check here reads a property
// whose value is a literal in the source CSS. Asserting a token-valued property
// would pass on an empty string and prove nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

  it("leaves no dropped declaration anywhere in the shipped stylesheet", () => {
    // ‼️ This is the assertion that caught the real bug, and the per-fixture
    // checks above are not a substitute for it: the single `/g` pass handled
    // every fixture correctly and still shipped `content-visibility: auto`,
    // because editor/tables.css puts two dropped declarations back to back and
    // the first match ate the separator the second one needed. Only a sweep of
    // the WHOLE output can see that.
    const css = buildExportStylesheet();
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
    const tip = mount(`<div class="callout callout-tip"></div>`)
      .firstElementChild as HTMLElement;
    const tipColor = getComputedStyle(tip).borderLeftColor;
    const bug = mount(`<div class="callout callout-bug"></div>`)
      .firstElementChild as HTMLElement;

    expect(tipColor).toBe("rgb(16, 185, 129)");
    expect(getComputedStyle(bug).borderLeftColor).not.toBe(tipColor);
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
