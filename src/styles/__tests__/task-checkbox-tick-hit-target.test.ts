// §5.1 — a done task's checkbox stopped un-checking.
//
// `li[data-type="taskItem"][data-checked="true"] > label::after` draws the tick and
// `> label input[type="checkbox"]` is the stretched, invisible hit target. Both are
// `position: absolute` with `z-index: auto`, so absent an explicit override they paint
// — and hit-test — in DOM order, and the tick is generated as the label's LAST child.
// It therefore sits on top of the input over roughly the middle quarter of a checked
// box, including dead centre. A hit on a pseudo-element reports the ORIGINATING
// element (the label) as `event.target`, and `task-item.ts`'s mousedown handler bails
// on any target that is not an `HTMLInputElement` — so a click aimed at a done box's
// centre silently does nothing.
//
// This is a hit-test result, which jsdom cannot produce (no layout, no
// `elementFromPoint`). A synthetic mousedown dispatched straight at the input would
// pass before AND after the fix — it never exercises the paint-order question at all.
// So this file pins the one CSS declaration that keeps the tick out of hit-testing
// instead: `pointer-events: none` on the tick rule. The hit-test itself was verified
// separately in a real headless browser (11x11 grid over the control): before the fix,
// the checked box's centre resolved to the LABEL; after, to the INPUT, in both states.
import { describe, expect, it } from "vitest";

import { cssDeclarations, cssRules, objectProperty } from "./css-rules";

const RULES = cssRules();

function propertyOf(body: string, prop: string): null | string {
  return objectProperty(
    cssDeclarations(body)
      .map((d) => `${d.prop}:${d.value}`)
      .join(","),
    new RegExp(`^${prop}$`),
  );
}

describe("done task checkbox tick does not steal the un-check click (§5.1)", () => {
  it("found the tick rule, so the assertion below is not vacuous", () => {
    const tick = RULES.filter(
      (r) =>
        r.selector.includes('[data-checked="true"]') &&
        r.selector.includes("label::after"),
    );
    expect(tick.length).toBe(1);
  });

  it("the tick is excluded from hit-testing, so the stretched input beneath it stays the topmost element", () => {
    const tick = RULES.find(
      (r) =>
        r.selector.includes('[data-checked="true"]') &&
        r.selector.includes("label::after"),
    )!;
    expect(propertyOf(tick.body, "pointer-events")).toBe("none");
  });
});
