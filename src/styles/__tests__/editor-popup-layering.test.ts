// §323 whole-branch review, Critical 1 — the editor's suggestion menus painted
// UNDERNEATH the Quick Capture dialog.
//
// `.slash-menu-popup`, `.wikilink-menu-popup` and `.mention-menu-popup` sat at
// `z-index: 50`; `.quick-capture-overlay` is `z-index: 200` and `#root`
// establishes no stacking context, so the dialog's opaque background covered
// them completely. The suggestion `onKeyDown` still ran, so typing `/` in the
// capture box silently hijacked the arrow keys and Enter with no visible menu.
// `.tag-menu-popup` happened to be at 1000 — that is the only reason `#tag`
// autocomplete worked there, and why nobody noticed the other three.
//
// The class list is DERIVED, not typed out here. An enumerated list of popups
// is exactly the guard that lets the next member escape: whoever adds the sixth
// body-mounted menu would have to remember to also edit this file, and the
// whole point is that they don't. So this scans the extension sources for the
// two ways a popup gets mounted on `document.body` and asks the stylesheet
// about whatever it finds.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules, walk } from "./css-rules";

/** The custom property every body-mounted editor popup must resolve through. */
const TOKEN = "--z-editor-popup";

/**
 * Classes of popups that extensions append to `document.body`.
 *
 * Two shapes, because the codebase has two:
 *  - `popupClass: "…"` — every `createSuggestionRenderer` caller; the renderer
 *    itself does the `document.body.appendChild`, so the class arrives as a
 *    variable there and can only be read at the call sites.
 *  - a literal `.className = "…"` on the very element handed to
 *    `document.body.appendChild(…)` — `slash-command.ts` (which builds its own
 *    popup) and `math-inline-edit.ts` (the inline-math preview overlay).
 *
 * The second shape keys off the appended element BY NAME rather than taking
 * every `className` literal in the file: the math overlay has two children
 * that also get classes, and those are inside the overlay's own stacking
 * context — asking the stylesheet for a `z-index` they must not have would
 * fail this guard for a rule that is perfectly correct.
 */
function bodyMountedPopupClasses(): string[] {
  const found = new Set<string>();
  for (const file of walk("src/extensions", ".ts")) {
    if (file.includes("__tests__")) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/popupClass:\s*"([\w-]+)"/gu)) {
      found.add(match[1]);
    }
    for (const mount of source.matchAll(
      /document\.body\.appendChild\(\s*([\w.]+)\s*\)/gu,
    )) {
      const element = mount[1].replaceAll(".", String.raw`\.`);
      // Only a string literal is resolvable here. `state.popup.className =
      // popupClass` is a variable — that path is the `popupClass:` scan above.
      for (const named of source.matchAll(
        new RegExp(String.raw`${element}\.className\s*=\s*"([\w-]+)"`, "gu"),
      )) {
        found.add(named[1]);
      }
    }
  }
  return [...found].sort();
}

/** A single declaration's value from the first rule matching `selector`. */
function declaration(selector: string, prop: string): string {
  const rule = cssRules().find((r) => r.selector === selector);
  if (!rule) throw new Error(`CSS rule not found: ${selector}`);
  const value = cssDeclarations(rule.body).find((d) => d.prop === prop)?.value;
  if (value === undefined) {
    throw new Error(`${selector} has no \`${prop}\` declaration`);
  }
  return value;
}

/** The numeric value `--z-editor-popup` is defined as, wherever it is defined. */
function tokenValue(): number {
  for (const rule of cssRules()) {
    const value = cssDeclarations(rule.body).find(
      (d) => d.prop === TOKEN,
    )?.value;
    if (value !== undefined) return Number(value);
  }
  throw new Error(`${TOKEN} is not defined in any stylesheet`);
}

describe("§323 body-mounted 편집기 팝업의 레이어링", () => {
  it("스캐너가 실제로 팝업들을 찾아낸다", () => {
    // A derivation that silently finds nothing would make every assertion
    // below vacuous — `expect([]).toEqual([])` passes forever. Pin both the
    // count floor and the two menus the defect was actually about.
    const classes = bodyMountedPopupClasses();
    expect(classes.length).toBeGreaterThanOrEqual(5);
    // One from each of the two shapes, so neither branch can quietly stop
    // matching and leave the other carrying the whole guard.
    expect(classes).toContain("mention-menu-popup"); // popupClass:
    expect(classes).toContain("slash-menu-popup"); // appendChild + className
  });

  it.each(bodyMountedPopupClasses())(
    ".%s는 z-index를 공용 토큰으로 받는다",
    (popupClass) => {
      // A bare number here is the defect: it reads as "above the editor" while
      // what it actually competes with is the dialog overlay the editor is in.
      expect(declaration(`.${popupClass}`, "z-index")).toBe(`var(${TOKEN})`);
    },
  );

  it("토큰 값은 캡처 다이얼로그 오버레이보다 위다", () => {
    // The concrete pin for this defect. `.quick-capture-overlay` is the one
    // dialog overlay that hosts a full editor today; lower the token back
    // under it and the menus disappear again exactly as they did.
    const overlay = Number(declaration(".quick-capture-overlay", "z-index"));
    expect(Number.isNaN(overlay)).toBe(false);
    expect(tokenValue()).toBeGreaterThan(overlay);
  });

  it("토큰 값은 다이얼로그 오버레이 대역 전체를 넘어선다", () => {
    // Why not just "above the capture dialog": the rule has to survive the
    // NEXT dialog that grows an editor, without anyone re-auditing which
    // dialogs host one. `.plugin-consent-overlay` (1100) is the highest of the
    // ordinary dialog band, so the token clears that whole band.
    expect(tokenValue()).toBeGreaterThan(
      Number(declaration(".plugin-consent-overlay", "z-index")),
    );
  });
});
