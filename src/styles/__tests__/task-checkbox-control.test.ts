// §5.1 / §18.18 M4 — the task control's two silent-failure modes, pinned.
//
// This file replaces `task-checkbox-tick-hit-target.test.ts`, which pinned
// `pointer-events: none` on the checked tick. That declaration guarded a hazard
// created by the OLD two-element control (a `<label>` drawing the box with an
// invisible `<input>` stretched over it): a press landing on the label's tick
// reported the label as `event.target`, and the handler — which accepted only
// an `HTMLInputElement` — silently did nothing. M4 replaced the pair with one
// `<button>`, whose pseudo-elements originate on itself, and the handler now
// resolves a press with `closest(".task-checkbox")`. The hazard has no seam to
// live in any more, so its guard is retired rather than carried along.
//
// What replaces it are the two ways this control can now fail WITHOUT anyone
// noticing — both invisible in the editor, both surfacing only in an export or
// in a state a given user happens not to use.
import { describe, expect, it } from "vitest";

import { cssRules } from "./css-rules";

const RULES = cssRules().filter((r) => r.selector.includes(".task-checkbox"));

describe("task checkbox control (§18.18 M4)", () => {
  it("found the control's rules, so the assertions below are not vacuous", () => {
    expect(RULES.length).toBeGreaterThan(3);
  });

  // The export strips every pressable element and retags `.task-checkbox` to a
  // `<span>` so the state survives into a PDF (export-html-chrome.ts). That
  // only works while the rules select by CLASS: written as
  // `button.task-checkbox` — the obvious tidy-up — every rule here would stop
  // matching the retagged span, and every exported document would print its
  // tasks as bare text with no boxes at all. Nothing in the editor would look
  // wrong.
  it("selects by class, never by tag, so the export's retag to <span> keeps painting", () => {
    const tagged = RULES.filter((r) => /\bbutton\b/.test(r.selector));
    expect(tagged.map((r) => r.selector)).toEqual([]);
  });

  // A state with no rule of its own is drawn as the base box — which is what
  // `todo` looks like. `doing` and `cancelled` would round-trip through the
  // file correctly and appear, on screen, to have been ignored.
  it.each(["done", "doing", "cancelled"])(
    "paints a distinct glyph for `%s`",
    (state) => {
      const painted = RULES.filter((r) =>
        r.selector.includes(`[data-state="${state}"]`),
      );
      expect(painted.length).toBeGreaterThan(0);
    },
  );
});
