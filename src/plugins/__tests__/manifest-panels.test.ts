// §394 spec 0073 D14 · §4 · §11 · plan 0126 P10 — `contributions.panels` in the manifest: the shape of
// each entry, who may declare panels (a sandboxed plugin with `sidebar`), and which panels a load
// registers. Each row's doc names what fails it.
import { describe, expect, it } from "vitest";

import { validateManifest } from "../manifest";
import {
  declaredPanels,
  MAX_PANEL_ICON_CHARS,
  MAX_PANELS,
} from "../manifest-panels";
import { MAX_PANEL_ID_CHARS } from "../rendered/limits";

const BASE = {
  author: "a",
  capabilities: ["sidebar"],
  contributions: {
    panels: [{ icon: "🕘", id: "recent", title: "Recent notes" }],
  },
  description: "d",
  engines: { baram: ">=0.7.7" },
  id: "sb",
  license: "MIT",
  main: "index.mjs",
  name: "SB",
  trust: "sandboxed",
  version: "1.0.0",
};

/** The errors `validateManifest` reports for BASE with `over` applied, or `[]`. */
function errorsOf(
  over: Record<string, unknown>,
): Array<{ field: string; message: string }> {
  const result = validateManifest({ ...BASE, ...over });
  return result.valid ? [] : result.errors;
}

const panels = (list: unknown[]) => ({ contributions: { panels: list } });

describe("contributions.panels — the entries", () => {
  /** The pair every refusal below needs: a full declaration is valid. What fails this: a rule that
   *  refuses a legal entry — three panels, an underscore in an id, an icon of several code points. */
  it("accepts up to three panels with ids, titles and one-character icons", () => {
    expect(MAX_PANELS).toBe(3);
    expect(
      errorsOf(
        panels([
          { icon: "🕘", id: "recent", title: "Recent notes" },
          { icon: "👨‍👩‍👧", id: "people", title: "People" },
          { id: "plain_2", title: "Plain" },
        ]),
      ),
    ).toEqual([]);
  });

  /** What fails this: no cap, no duplicate check, `requireId` not applied to `id`, or no title
   *  check — each removes one field from the list. */
  it("refuses a fourth panel, a duplicate id, a malformed id and an empty title", () => {
    expect(
      errorsOf(
        panels([
          { id: "a", title: "A" },
          { id: "a", title: "B" },
          { id: "b:c", title: "C" },
          { id: "d", title: "" },
        ]),
      ).map((e) => e.field),
    ).toEqual([
      "contributions.panels",
      "contributions.panels[1].id",
      "contributions.panels[2].id",
      "contributions.panels[3].title",
    ]);
  });

  /** A panel id is bounded like every contribution id (`MAX_CONTRIBUTION_ID_CHARS`, `manifest.ts`), and
   *  the transport's `isSetPanel` bounds it with the same number from `limits.ts`. What fails this: the
   *  two drifting apart — a longer manifest bound admits the over-long id below, whose `setPanel` the
   *  transport would drop; a shorter one refuses the max-length id. */
  it("takes an id of MAX_PANEL_ID_CHARS and refuses a longer one", () => {
    const id = "p".repeat(MAX_PANEL_ID_CHARS);
    expect(errorsOf(panels([{ id, title: "P" }]))).toEqual([]);
    expect(
      errorsOf(panels([{ id: `${id}p`, title: "P" }])).map((e) => e.field),
    ).toEqual(["contributions.panels[0].id"]);
  });

  /** P10 · P25 — an icon is one grapheme within 16 UTF-16 units. What fails this: counting UTF-16
   *  units or code points instead of graphemes (🇰🇷 is two code points, 👨‍👩‍👧 five — both refused), or
   *  no length cap (`e` + sixteen combining accents is one grapheme of 17 units). */
  it("takes an icon of one character, however many code points, within the cap", () => {
    for (const icon of ["🕘", "🇰🇷", "👨‍👩‍👧", "가", "R"]) {
      expect(errorsOf(panels([{ icon, id: "p", title: "P" }]))).toEqual([]);
    }
    for (const icon of [
      "",
      "ab",
      "🕘🕘",
      `e${"́".repeat(MAX_PANEL_ICON_CHARS)}`,
      7,
    ]) {
      expect(
        errorsOf(panels([{ icon, id: "p", title: "P" }])).map((e) => e.field),
      ).toEqual(["contributions.panels[0].icon"]);
    }
  });
});

describe("contributions.panels — who may declare them", () => {
  /** §4 — what fails this: no pair check; the install dialog would ask nothing about the panels. */
  it("needs the sidebar capability", () => {
    const errors = errorsOf({ capabilities: [] });
    expect(errors.map((e) => e.field)).toEqual(["capabilities"]);
    expect(errors[0].message).toMatch(/needs the "sidebar" capability/);
  });

  /** P10 — a trusted plugin's declared panels would draw nothing: that tier mounts its own DOM. What
   *  fails this: no tier check (the declaration is silently dead). */
  it("refuses panels in a trusted manifest, pointing at ui.addSidebarPanel", () => {
    const errors = errorsOf({ trust: "trusted" });
    expect(errors.map((e) => e.field)).toEqual(["contributions.panels"]);
    expect(errors[0].message).toMatch(/ui\.addSidebarPanel/);
  });

  /** P10 — the reverse is not an error, in either tier. What fails this: turning `sidebar` without
   *  `panels` into an error, which would drop an installed plugin at its next load. */
  it("keeps sidebar without panels valid in both tiers", () => {
    expect(errorsOf({ contributions: {} })).toEqual([]);
    expect(errorsOf({ contributions: {}, trust: "trusted" })).toEqual([]);
  });
});

describe("declaredPanels", () => {
  /** P9 — what a load registers: nothing when a consent narrowed `sidebar` away, the declaration
   *  otherwise. What fails this: a list read without the capability check. */
  it("is empty without sidebar and the declaration with it", () => {
    const manifest = {
      capabilities: ["sidebar" as const],
      contributions: BASE.contributions,
    };
    expect(declaredPanels(manifest)).toEqual(BASE.contributions.panels);
    expect(declaredPanels({ ...manifest, capabilities: [] })).toEqual([]);
    expect(
      declaredPanels({ capabilities: ["sidebar"], contributions: {} }),
    ).toEqual([]);
  });
});
