// §361 Task 6 / spec 0049 §10.2 — which installed themes the registry now has a different
// version of, for the badge on the Installed group.
//
// ‼️ THIS IS THE ONLY PLACE THAT ASKS. Spec §10.2 says a theme update must not appear in the
// plugin Updates tab, and `registry-client.ts`'s `checkForUpdates` — which the 24-hour
// background `update-checker.ts` drives — iterates `usePluginStore`'s `installedPlugins`.
// A theme is never written there: `installTheme`'s record goes to the settings store via
// `addInstalledTheme`, and the one action that puts a NEW id into `installedPlugins` is
// `addPlugin` (`stores/system/plugin.ts` — its three other writers are `setEnabled` and
// `updatePluginVersion`, which both bail on an id that is not already present, and
// `removePlugin`, which only ever drops one), which nothing on the theme path calls. So
// themes stay out of that tab by
// construction rather than by a filter, and the price is that a theme update is discovered
// when the Appearance tab is opened rather than in the background. That is the right price
// for a badge nothing else renders.
//
// The fetch is skipped entirely when nothing is installed, so opening Appearance on a fresh
// profile — overwhelmingly the common case — touches the network zero times. When something
// IS installed it goes through `fetchRegistryIndex`'s 24-hour cache, so repeatedly opening
// the tab costs one request a day.
import { useEffect, useState } from "react";

import type { RegistryEntry, RegistryIndex } from "../../../plugins/types";

import {
  fetchRegistryIndex,
  themeUpdatesFor,
} from "../../../plugins/registry-client";
import { useSettingsStore } from "../../../stores/settings/store";
import { logger } from "../../../utils/logger";

export function useThemeUpdates(): {
  index: null | RegistryIndex;
  updates: Record<string, RegistryEntry>;
} {
  const installedThemes = useSettingsStore((s) => s.installedThemes);
  const [index, setIndex] = useState<null | RegistryIndex>(null);

  const installedCount = Object.keys(installedThemes).length;
  useEffect(() => {
    if (installedCount === 0) return;
    let active = true;
    fetchRegistryIndex()
      .then((fetched) => {
        if (active) setIndex(fetched);
      })
      // Swallowed, as `ThemeBrowser.tsx` does NOT: there the user asked to see the
      // registry and an empty screen needs explaining, whereas here a failed check means
      // one badge does not appear on a screen the user opened to change colours. An error
      // banner over the theme gallery would be noise about something nobody asked for.
      .catch((err: unknown) =>
        logger.warn("[Theme] update check failed:", err),
      );
    return () => {
      active = false;
    };
  }, [installedCount]);

  return {
    index,
    // Recomputed on every render rather than memoised: it is a loop over the installed
    // themes (a handful) against the index, and a `useMemo` keyed on two objects that are
    // both replaced on any settings write would recompute about as often anyway.
    updates: index === null ? {} : themeUpdatesFor(index, installedThemes),
  };
}
