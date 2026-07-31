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
  accentSolidHoverFill,
  onSolidForeground,
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
  ...STATUS_FAMILIES.map((family) => `--color-status-${family}-on-solid`),
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
    "--color-accent-solid-hover": accentSolidHoverFill(solid),
  };
  for (const family of STATUS_FAMILIES) {
    derived[`--color-status-${family}-on-solid`] = onSolidForeground(
      colors[`--color-status-${family}`],
    );
  }
  return derived;
}
