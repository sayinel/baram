// §54 Theme System — the one place that writes theme CSS variables (#330)
//
// Themes used to be applied by iterating ThemeColors at each call site while a
// separate hand-listed array did the clearing. The two drifted: the clear list
// covered 16 of the 25 keys, so nine overrides survived a switch back to a default
// theme. Both lists are now derived from THEME_COLOR_KEYS, and the accent pairing
// derived from the theme's own accent lives here too, so a colour and the
// foreground computed from it can never be applied out of step.

import type { ThemeColors } from "../types/theme";

import { THEME_COLOR_KEYS } from "../types/theme";
import {
  accentSolidFill,
  accentSolidHoverFill,
  onSolidForeground,
} from "./color-contrast";

/**
 * CSS variables computed from a theme rather than stored in it.
 *
 * Deliberately not ThemeColors keys: they are consequences of the accent, so
 * exposing them in the theme editor would let a user save a pairing that fails
 * contrast. `src/styles/generated/` carries the matching values for the default
 * themes and for `system`, which apply no inline overrides at all.
 */
export const DERIVED_ACCENT_KEYS = [
  "--color-accent-on-solid",
  "--color-accent-solid",
  "--color-accent-solid-hover",
] as const;

/** Write a theme's colours and its derived accent pairing to `root`. */
export function applyThemeVars(
  root: HTMLElement,
  colors: ThemeColors,
  base: "dark" | "light",
): void {
  for (const [key, value] of Object.entries(colors)) {
    root.style.setProperty(key, value);
  }
  for (const [key, value] of Object.entries(derivedAccentVars(colors, base))) {
    root.style.setProperty(key, value);
  }
}

/** Remove every variable {@link applyThemeVars} can set, so the cascade governs again. */
export function clearThemeVars(root: HTMLElement): void {
  for (const { key } of THEME_COLOR_KEYS) {
    root.style.removeProperty(key);
  }
  for (const key of DERIVED_ACCENT_KEYS) {
    root.style.removeProperty(key);
  }
}

/** The accent fill, its hover, and the foreground that clears AA on both. */
export function derivedAccentVars(
  colors: ThemeColors,
  base: "dark" | "light",
): Record<string, string> {
  const solid = accentSolidFill(
    colors["--color-accent-default"],
    colors["--color-accent-hover"],
    base,
  );
  return {
    "--color-accent-on-solid": onSolidForeground(solid),
    "--color-accent-solid": solid,
    "--color-accent-solid-hover": accentSolidHoverFill(solid),
  };
}
