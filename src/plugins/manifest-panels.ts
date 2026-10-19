// §394 spec 0073 D14 · §4 · §11 — `contributions.panels`, a sandboxed plugin's sidebar panels, and the
// `sidebar` capability they need. A file of its own for the reason `manifest-code-blocks.ts` is one:
// `manifest.ts` is past 600 lines. The checks come in from `validateContributions` /
// `validateManifest`, which own the error list.

import type { ContributionChecks } from "./manifest-entry-points";
import type { PluginContributions, PluginManifest } from "./types";

/** D14 — panels one plugin may declare. */
export const MAX_PANELS = 3;

/**
 * The longest `icon` in UTF-16 units — room for an emoji sequence joined by ZWJ (👨‍👩‍👧 is 8). The
 * activity bar draws it as one glyph at `font-size: 18px` (`.activity-bar-plugin-icon`) inside a 40 px
 * button (`.activity-bar-btn`), beside built-in lucide icons drawn at 22 px (`ICON_PROPS`).
 */
export const MAX_PANEL_ICON_CHARS = 16;

/**
 * Grapheme clusters — what a reader sees as one character. Available wherever a manifest is
 * validated: the app's WebView, and Node for `scripts/community-gate.ts` (plan 0126 P25).
 */
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * D14 · plan 0126 P10 — who may declare `panels`. A trusted manifest may not: that tier mounts its own
 * DOM with `ui.addSidebarPanel`, so its declaration would draw nothing — the dead control
 * `requireDeclaredCommand` refuses for the same reason. A sandboxed one needs `sidebar`, so the
 * install dialog can say so. The reverse is not an error: `sidebar` without `panels` stays valid in
 * both tiers, as it was before §394 — refusing it would drop an installed plugin at its next load.
 */
export function checkPanelDeclarations(
  trust: unknown,
  capabilities: unknown,
  contributions: unknown,
  report: (field: string, message: string) => void,
): void {
  const list =
    typeof contributions === "object" &&
    contributions !== null &&
    !Array.isArray(contributions)
      ? (contributions as Record<string, unknown>).panels
      : undefined;
  if (!Array.isArray(list) || list.length === 0) return;
  if (trust === "trusted") {
    report(
      "contributions.panels",
      'contributions.panels is for trust: "sandboxed" — a trusted plugin adds a panel with ui.addSidebarPanel',
    );
    return;
  }
  if (Array.isArray(capabilities) && !capabilities.includes("sidebar")) {
    report(
      "capabilities",
      'contributions.panels needs the "sidebar" capability — the install dialog has to be able to say so',
    );
  }
}

/**
 * The panels a load registers: none without `sidebar` (a consent that narrowed the capability away
 * registers nothing, as `registerDeclaredStatusBar` does for `statusbar`), else the declared ones.
 */
export function declaredPanels(
  manifest: Pick<PluginManifest, "capabilities" | "contributions">,
): NonNullable<PluginContributions["panels"]> {
  if (!manifest.capabilities.includes("sidebar")) return [];
  return manifest.contributions?.panels ?? [];
}

/** D14 · §4 — `contributions.panels`: objects, capped, ids well-formed and unique, a title, an optional one-character icon. */
export function validatePanels(check: ContributionChecks): void {
  const list = check.entries("panels");
  if (!list) return;
  if (list.length > MAX_PANELS) {
    check.report(
      "contributions.panels",
      `at most ${MAX_PANELS} panels may be declared`,
    );
  }
  check.rejectDuplicateIds("panels", list);
  list.forEach((entry, i) => {
    const at = `contributions.panels[${i}]`;
    check.requireId(entry.id, `${at}.id`);
    if (typeof entry.title !== "string" || entry.title.length === 0) {
      check.report(`${at}.title`, `${at}.title must be a non-empty string`);
    }
    if (entry.icon !== undefined && !isOneCharacter(entry.icon)) {
      check.report(
        `${at}.icon`,
        `${at}.icon must be one character — an emoji or a letter — of at most ${MAX_PANEL_ICON_CHARS} UTF-16 units`,
      );
    }
  });
}

/** One grapheme cluster, at most `MAX_PANEL_ICON_CHARS` UTF-16 units long. */
function isOneCharacter(value: unknown): boolean {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PANEL_ICON_CHARS
  ) {
    return false;
  }
  return [...graphemes.segment(value)].length === 1;
}
