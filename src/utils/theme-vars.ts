// §54 Theme System — the one place that writes theme CSS variables (#330)
//
// Themes used to be applied by iterating ThemeColors at each call site while a
// separate hand-listed array did the clearing. The two drifted: the clear list
// covered 16 of the 25 keys, so nine overrides survived a switch back to a default
// theme. Both lists are now derived from THEME_COLOR_KEYS, and the foregrounds
// derived from the theme's own colours live here too, so a colour and the
// foreground computed from it can never be applied out of step.

import type { ThemeColors } from "../types/theme";

import { THEME_COLOR_KEYS } from "../types/theme";
import {
  accentSolidFill,
  onSolidForeground,
  solidHoverFill,
} from "./color-contrast";

/** Status families that are used as a filled surface with text on them. */
const STATUS_FAMILIES = ["danger", "success", "warning"] as const;

/**
 * CSS variables computed from a theme rather than stored in it.
 *
 * Deliberately not ThemeColors keys: they are consequences of the colours the user
 * does pick, so exposing them in the theme editor would let a user save a pairing
 * that fails contrast. `src/styles/generated/` carries the matching values for the
 * default themes and for `system`, which apply no inline overrides at all.
 */
export const DERIVED_KEYS = [
  "--color-accent-on-solid",
  "--color-accent-solid",
  "--color-accent-solid-hover",
  // Spelled out rather than generated from STATUS_FAMILIES: spreading a mapped
  // array widens those elements to `string`, so a typo in the template would
  // compile clean and only surface as a variable nothing reads.
  "--color-status-danger-on-solid",
  "--color-status-danger-solid-hover",
  "--color-status-success-on-solid",
  "--color-status-success-solid-hover",
  "--color-status-warning-on-solid",
  "--color-status-warning-solid-hover",
] as const;

/** Write a theme's colours and every foreground derived from them to `root`. */
export function applyThemeVars(
  root: HTMLElement,
  colors: ThemeColors,
  base: "dark" | "light",
): void {
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(key, value);
  }
  for (const [key, value] of Object.entries(derivedVars(colors, base))) {
    root.style.setProperty(key, value);
  }
}

/** Remove every variable {@link applyThemeVars} can set, so the cascade governs again. */
export function clearThemeVars(root: HTMLElement): void {
  for (const { key } of THEME_COLOR_KEYS) {
    root.style.removeProperty(key);
  }
  for (const key of DERIVED_KEYS) {
    root.style.removeProperty(key);
  }
}

/**
 * Every foreground and fill this module computes from a theme's own colours.
 *
 * The status families get the same treatment as the accent because they are also
 * user-editable (`THEME_COLOR_KEYS`, category "Status"). They need no `-solid` fill
 * of their own: unlike the accent, no status colour is stepped — only the text on
 * it is chosen.
 */
export function derivedVars(
  colors: ThemeColors,
  base: "dark" | "light",
): Record<string, string> {
  const solid = accentSolidFill(
    colors["--color-accent-default"],
    colors["--color-accent-hover"],
    base,
  );
  const derived: Record<string, string> = {
    "--color-accent-on-solid": onSolidForeground(solid),
    "--color-accent-solid": solid,
    "--color-accent-solid-hover": solidHoverFill(solid),
  };
  for (const family of STATUS_FAMILIES) {
    const fill = colors[`--color-status-${family}`];
    derived[`--color-status-${family}-on-solid`] = onSolidForeground(fill);
    // Derived rather than expressed as a `color-mix` in the stylesheet, because the
    // direction depends on which foreground the fill took: Solarized's `#dc322f`
    // takes white, every other theme's danger takes black, and a constant direction
    // breaks whichever group it moves toward.
    derived[`--color-status-${family}-solid-hover`] = solidHoverFill(fill);
  }
  return derived;
}
