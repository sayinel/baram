import type { ThemeDef, ThemeMode } from "../types/theme";
// §361 InstalledTheme → ThemeDef, so `findThemeById`·`theme-gallery.tsx` treat a community
// row exactly like any other (theme-sources.ts's whole point — no `source === "community"`
// branch at the call sites below).
//
// Colors come straight off the persisted record (`InstalledThemeMode.colors`, small — see
// `theme-install.ts`'s `InstalledTheme` doc comment). CSS text is deliberately NOT
// persisted there — only a `css: boolean` flag is — so a mode a theme declared CSS for
// gets it only when the caller supplies `cssByKey`, which `use-theme-css-hydration.ts`
// fills by reading it off disk. Every function here stays pure and synchronous; the async
// disk read lives in that hook, not here.
import type { InstalledTheme } from "./theme-install";

const MODE_KEYS: readonly ThemeMode[] = ["light", "dark"];

/** The key `useThemeCssCacheStore` stores a mode's stored CSS under. */
export function themeCssCacheKey(themeId: string, mode: ThemeMode): string {
  return `${themeId}:${mode}`;
}

/**
 * One installed theme's record → the `ThemeDef` the gallery and the apply pipeline read.
 *
 * `cssByKey` defaults to `{}` — a caller that only needs mode existence (which modes exist,
 * for `themeFieldFor`/`resolveThemeMode`) never needs to pass it, and every `modes[mode].css`
 * comes back `undefined` exactly as if the theme carried no CSS.
 */
export function installedThemeToDef(
  installed: InstalledTheme,
  cssByKey: Record<string, string> = {},
): ThemeDef {
  const modes: ThemeDef["modes"] = {};
  for (const mode of MODE_KEYS) {
    const declared = installed.modes[mode];
    if (declared === undefined) continue;
    modes[mode] = {
      colors: declared.colors,
      css: declared.css
        ? cssByKey[themeCssCacheKey(installed.id, mode)]
        : undefined,
    };
  }
  return {
    id: installed.id,
    modes,
    name: installed.manifest.name,
    source: "community",
  };
}

/** Every installed theme, converted. Order is not meaningful — callers that render a grid
 *  already order by iterating `BUILT_IN_THEMES`/`customThemes` first; this is appended. */
export function installedThemeDefs(
  installedThemes: Record<string, InstalledTheme>,
  cssByKey?: Record<string, string>,
): ThemeDef[] {
  return Object.values(installedThemes).map((installed) =>
    installedThemeToDef(installed, cssByKey),
  );
}

/**
 * `findThemeById`'s second argument, extended with installed (community) themes.
 *
 * A small helper rather than inlining `[...customThemes, ...installedThemeDefs(...)]` at
 * every call site (`appearance-settings.ts`, `store.ts`'s rehydrate sync,
 * `use-settings-effects.ts`, `ThemeEditor.tsx`) — four repeats of the same expression is
 * the shape that drifts when a fifth source is ever added.
 */
export function lookupThemes(
  customThemes: ThemeDef[],
  installedThemes: Record<string, InstalledTheme>,
  cssByKey?: Record<string, string>,
): ThemeDef[] {
  return [...customThemes, ...installedThemeDefs(installedThemes, cssByKey)];
}
