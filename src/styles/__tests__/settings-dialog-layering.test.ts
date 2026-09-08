// §206 — the update dialog painted UNDERNEATH the Settings modal.
//
// `.update-dialog-overlay` sat at `z-index: 110` while `.settings-overlay` is
// 1000. Both are `position: fixed`, both are rendered as plain siblings inside
// `AppDialogs` with no portal between them, so they share one stacking context
// and 110 loses. The dialog's only open paths are the "Check Now" and
// "Update to vX" buttons in Settings > General > Updates — that is, it is only
// ever opened while the thing covering it is on screen. The button worked, the
// component mounted, the store said `dialogOpen`, and the user saw nothing:
// the in-app update was unreachable from the UI. `.about-overlay` carried the
// same 110 and the same exposure, since the Help menu opens About through
// `use-menu-event-handler.ts` without caring whether Settings is up.
//
// The class list is DERIVED from the settings components, not typed out here.
// An enumerated list is the guard that lets the next member escape — whoever
// adds the next dialog under `components/settings/` would have to remember
// this file, and the whole point is that they don't. Membership in the scan is
// "renders its own full-screen overlay and lives in the settings family", which
// is exactly the population that can be on screen at the same time as Settings.
// `.smart-template-overlay` is deliberately NOT in it: its stylesheet lives
// under `styles/settings/` but the dialog is opened from the editor's slash
// menu (`slash-command-items-ai.ts`), so a directory-based scan would demand a
// change to a rule that is already correct.
//
// ‼️ SIBLING vs NESTED is the whole distinction. `.settings-overlay` carries a
// `z-index`, so it establishes a stacking context and anything rendered INSIDE
// it is scoped — the journal-migration dialog sits at 300 and is perfectly
// visible, because `JournalSection` renders it in its own JSX. Only a dialog
// rendered as a SIBLING of the Settings modal (the `AppDialogs` list) competes
// with it on the root stacking context, and those are the ones scanned here. A
// nested dialog that ever does land in this scan loses nothing by clearing
// 1000 anyway, since its own value is scoped and arbitrary.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules, walk } from "./css-rules";

/** The overlay every other one in this family has to clear. */
const BASELINE = "settings-overlay";

/** The ceiling: the consent dialog must stay the topmost surface. */
const CEILING = "plugin-consent-overlay";

/**
 * Overlay classes rendered by components in the settings family, minus the
 * Settings modal's own.
 *
 * Read off the `className="…"` literal rather than a list, so the scan finds
 * whatever is there. Only a literal is resolvable this way; a computed class
 * would be missed, and none of these use one — the assertion below on the two
 * known members is what keeps that honest.
 */
function settingsFamilyOverlays(): string[] {
  const found = new Set<string>();
  for (const file of walk("src/components/settings", ".tsx")) {
    if (file.includes("__tests__")) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(
      /className="([a-z][\w-]*-overlay)"/gu,
    )) {
      if (match[1] !== BASELINE) found.add(match[1]);
    }
  }
  return [...found].sort();
}

/** The `z-index` of the first rule matching `.className`, as a number. */
function zIndexOf(className: string): number {
  const rule = cssRules().find((r) => r.selector === `.${className}`);
  if (!rule) throw new Error(`CSS rule not found: .${className}`);
  const value = cssDeclarations(rule.body).find(
    (d) => d.prop === "z-index",
  )?.value;
  if (value === undefined) {
    throw new Error(`.${className} has no \`z-index\` declaration`);
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`.${className} z-index is not a bare number: ${value}`);
  }
  return parsed;
}

describe("§206 설정창과 함께 뜨는 다이얼로그의 레이어링", () => {
  it("스캐너가 실제로 오버레이들을 찾아낸다", () => {
    // A derivation that silently finds nothing makes every assertion below
    // vacuous — `it.each([])` registers no tests and the file passes forever.
    // Pin the floor and both members the defect was actually about.
    const overlays = settingsFamilyOverlays();
    expect(overlays.length).toBeGreaterThanOrEqual(2);
    expect(overlays).toContain("update-dialog-overlay");
    expect(overlays).toContain("about-overlay");
    // The baseline must be excluded, or it would be asked to clear itself.
    expect(overlays).not.toContain(BASELINE);
  });

  it.each(settingsFamilyOverlays())(
    ".%s는 설정 오버레이 위에 그려진다",
    (overlay) => {
      // ‼️ BOTH numbers are read out of the stylesheet, because what matters is
      // the ORDER between them. Raising the settings overlay and lowering this
      // one are the same defect, and asserting a literal here would only see
      // one of them.
      expect(zIndexOf(overlay)).toBeGreaterThan(zIndexOf(BASELINE));
    },
  );

  it.each(settingsFamilyOverlays())(
    ".%s는 플러그인 설치 동의 다이얼로그보다 아래다",
    (overlay) => {
      // The ceiling, for the reason `plugins.css` gives: the consent dialog is
      // the last thing between a user and running third-party code, so nothing
      // may paint over it. Clearing Settings must not turn into clearing that.
      expect(zIndexOf(overlay)).toBeLessThan(zIndexOf(CEILING));
    },
  );
});
