// §323 whole-branch review, Important 2 + 3 — what the capture editor inherits
// from the DOCUMENT surface, and what it must not.
//
// `@tiptap/core` puts `class="tiptap"` on every editor's editable element, so
// `editor/base.css`'s `.tiptap` rule reaches the Quick Capture dialog's editor
// too. That rule is written for the document window, where it paints a page:
// `padding: 2rem var(--editor-padding)` with a global `--editor-padding: 4rem`,
// plus `font-size: 1rem`. Inside a 460px dialog those page margins ate 128px of
// horizontal room and 32px of vertical, leaving roughly a 272px writing column
// in a 192px-tall box — and the font-size overrode the 13px the dialog asked
// for. The same rule hard-codes a KOREAN placeholder string in `content:`
// rather than reading `attr(data-placeholder)`, so an English-locale user was
// told, in Korean, to type `/`.
//
// jsdom does no layout and applies no stylesheet cascade, so neither defect is
// observable from a rendered component. These guards read the real CSS text.
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules } from "./css-rules";

const DOCUMENT_SURFACE = ".tiptap";
const CAPTURE_SURFACE = ".quick-capture-editor .tiptap";

/**
 * Properties the capture editor deliberately KEEPS from the document surface.
 *
 * The point of an allowlist rather than a list of things to override: a new
 * declaration added to `.tiptap` fails this file until somebody decides which
 * side of the line it falls on. The default is "the capture box probably does
 * not want the document page's version of this", which is how both of these
 * defects got in.
 */
const INHERITED_FROM_DOCUMENT_SURFACE = new Set([
  // `color`, `font-family` and `line-height`: same typeface, ink and rhythm as
  // the document — the capture box is the same writing tool, just smaller.
  "color",
  "font-family",
  "line-height",
  // Fills the container so a click anywhere in the box lands in the editor.
  "min-height",
  // The container draws its own focus ring on `:focus-within`.
  "outline",
]);

function declaration(selector: string, prop: string): string {
  const value = cssDeclarations(rule(selector).body).find(
    (d) => d.prop === prop,
  )?.value;
  if (value === undefined) {
    throw new Error(`${selector} has no \`${prop}\` declaration`);
  }
  return value;
}

function rule(selector: string) {
  const found = cssRules().find((r) => r.selector === selector);
  if (!found) throw new Error(`CSS rule not found: ${selector}`);
  return found;
}

describe("§323 캡처 편집기 표면 — 문서창 페이지 여백을 물려받지 않는다", () => {
  it("문서창 `.tiptap`은 여전히 페이지 여백을 갖는다 — 이 파일의 전제", () => {
    // If this ever stops being true the guards below are guarding nothing, and
    // the failure should say so out loud instead of passing vacuously.
    expect(declaration(DOCUMENT_SURFACE, "padding")).toMatch(/\S/u);
    expect(declaration(DOCUMENT_SURFACE, "padding")).not.toBe("0");
  });

  it.each([...INHERITED_FROM_DOCUMENT_SURFACE].sort())(
    "`%s`는 문서창에서 그대로 물려받기로 한 속성이다",
    (prop) => {
      // The allowlist must describe the real rule, not a wish: an entry naming
      // a property `.tiptap` no longer sets would quietly excuse a property
      // that does exist under the same name later.
      expect(
        cssDeclarations(rule(DOCUMENT_SURFACE).body).map((d) => d.prop),
      ).toContain(prop);
    },
  );

  it("나머지 속성은 캡처 표면에서 전부 재정의된다", () => {
    const overridden = new Set(
      cssDeclarations(rule(CAPTURE_SURFACE).body).map((d) => d.prop),
    );
    const unhandled = cssDeclarations(rule(DOCUMENT_SURFACE).body)
      .map((d) => d.prop)
      .filter(
        (prop) =>
          !INHERITED_FROM_DOCUMENT_SURFACE.has(prop) && !overridden.has(prop),
      );
    expect(unhandled).toEqual([]);
  });

  it("페이지 여백과 글자 크기는 실제로 무력화된다 — 존재만이 아니라 값까지", () => {
    // `padding: 1rem` would satisfy "is overridden" while still stealing most
    // of a 460px dialog's width, so the values are pinned too.
    expect(declaration(CAPTURE_SURFACE, "padding")).toBe("0");
    expect(declaration(CAPTURE_SURFACE, "font-size")).toBe("inherit");
  });
});

describe("§323 캡처 편집기 안내 문구 — 로케일을 따른다", () => {
  const documentPlaceholder = `${DOCUMENT_SURFACE} p.is-editor-empty:first-child::before`;
  const capturePlaceholder = `${CAPTURE_SURFACE} p.is-editor-empty:first-child::before`;

  it("캡처 선택자는 문서 선택자를 그대로 감싼 것이다", () => {
    // Not cosmetic. Deriving the capture selector by prefixing the document
    // one is what makes it STRICTLY more specific by construction — one extra
    // class, everything else identical — so the override cannot lose the
    // cascade no matter which stylesheet is imported first. Rewriting it by
    // hand into some other shape is how that guarantee gets lost.
    expect(capturePlaceholder.endsWith(documentPlaceholder.slice(1))).toBe(
      true,
    );
    rule(documentPlaceholder);
    rule(capturePlaceholder);
  });

  it("문서창은 CSS에 박힌 문자열을 그대로 쓴다 — 이 파일의 전제", () => {
    // Deliberately unchanged by this fix: the document editor's placeholder is
    // out of scope. Recorded so the next reader knows the asymmetry is
    // intentional rather than half a migration.
    expect(declaration(documentPlaceholder, "content")).toMatch(/^"/u);
  });

  it("캡처는 Placeholder Extension이 심은 속성을 읽는다", () => {
    // `attr(data-placeholder)` is the whole fix: it hands the decision back to
    // `extensions/index.ts`, which translates it. A literal string here — in
    // EITHER language — is the defect, because CSS cannot see the locale.
    expect(declaration(capturePlaceholder, "content")).toBe(
      "attr(data-placeholder)",
    );
  });
});
