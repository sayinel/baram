// §361 — warms `theme-css-cache.ts` for the active installed theme's current mode, so
// `useSettingsEffects`'s apply effect (`use-settings-effects.ts`) can inject CSS a
// community theme shipped.
//
// Split out of that effect rather than folded into it: it is the one part of theme
// application that is genuinely async (an IPC round trip to re-read stored CSS off disk —
// `theme-store-fs.ts`'s `readStoredThemeCss`), while `useSettingsEffects`'s apply effect is
// a synchronous DOM write that must stay that way (#330 — splitting the write across two
// effects is exactly how a theme's variables and its `<style>` drifted before).
//
// Runs on every mount regardless of whether any theme is installed — the early return below
// is cheap (`installedThemes[activeThemeId]` is `undefined` for every builtin/custom theme,
// which is the common case).
import { useEffect, useState } from "react";

import type { InstalledTheme } from "../themes/theme-install";

import { useThemeCssCacheStore } from "../stores/system/theme-css-cache";
import {
  installedThemeToDef,
  themeCssCacheKey,
} from "../themes/installed-theme-defs";
import { readStoredThemeCss } from "../themes/theme-store-fs";
import { resolveThemeMode } from "../types/theme";

export function useThemeCssHydration(
  activeThemeId: string,
  installedThemes: Record<string, InstalledTheme>,
): void {
  const entries = useThemeCssCacheStore((s) => s.entries);
  const setCss = useThemeCssCacheStore((s) => s.setCss);

  // Its own `prefers-color-scheme` listener rather than sharing the one in
  // `use-settings-effects.ts`: this hook needs to know the OS preference to decide WHICH
  // mode's CSS to fetch, but has no other reason to touch that effect's internals, and a
  // hook that reads its own inputs is easier to test in isolation (see this file's test).
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setPrefersDark(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const installed = installedThemes[activeThemeId];
    if (installed === undefined) return;
    // `installedThemeToDef` with no `cssByKey` only ever tells us which modes EXIST — never
    // whether one is cached, so this can't loop with the cache write below.
    const mode = resolveThemeMode(installedThemeToDef(installed), prefersDark);
    if (mode === undefined) return;
    if (installed.modes[mode]?.css !== true) return;
    const key = themeCssCacheKey(installed.id, mode);
    if (entries[key] !== undefined) return;
    let active = true;
    void readStoredThemeCss(installed.id, mode).then((css) => {
      if (active && css !== null) setCss(key, css);
    });
    return () => {
      active = false;
    };
  }, [activeThemeId, installedThemes, prefersDark, entries, setCss]);
}
