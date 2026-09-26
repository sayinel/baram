// §379 — the dev folders Rust lists (`plugin_list_dev`), loaded the way this build allows.
//
// A dev build loads every folder Rust admitted (unapproved, missing and broken-manifest rows
// stay listed as issues, not loaded) as before §379: unbounded, unrevoked, unasked. A release
// build loads a folder only in developer mode and only when the consent Rust recorded still
// covers what its manifest asks; the rest stay listed with a "press Reload" error, because Reload
// is where the Developer section asks (`use-dev-plugin-actions.ts`).
import type { DevFolderRow } from "../ipc/plugin-invoke";
import type { DevFolderIssue } from "../stores/system/plugin";
import type { InstalledPlugin, PluginConsent, PluginManifest } from "./types";

import { type Locale, t } from "../i18n";
import { pluginListDev, toInstalledDevPlugin } from "../ipc/plugin-invoke";
import { useSettingsStore } from "../stores/settings/store";
import { usePluginStore } from "../stores/system/plugin";
import { logger } from "../utils/logger";
import { consentRequired } from "./plugin-consent";
import { pluginLoader } from "./plugin-loader";
import { pluginTrustOf } from "./plugin-trust";

/**
 * What consent a dev folder's row carries INTO this build — the single rule both loaders
 * (`refreshDevPlugins` here and `use-dev-plugin-actions.ts`'s `admit`) must read through
 * instead of `row.consent` directly.
 *
 * `plugin-dev.json` is the SAME file in both builds, and Rust's `folder_row` copies whatever
 * consent a row carries either way — a dev build must still drop it: choosing the directory
 * there is its own deliberate act, and the stored record must not imply this build read a
 * consent it never asked to narrow anything by.
 */
export function devRowConsent(
  devBuild: boolean,
  row: Pick<DevFolderRow, "consent">,
): null | PluginConsent {
  return devBuild ? null : row.consent;
}

/**
 * The consent to ask for before a dev folder's code runs — or `null` when nothing needs
 * asking: a dev build never asks, a recorded consent that still covers the manifest needs no
 * second yes, and a manifest with no tier is left to the loader's schema refusal.
 *
 * Coverage is `consentRequired`, the install flow's own rule, so a readonly narrowing
 * (`files` → `files:readonly`) asks nothing here either.
 */
export function devConsentToAsk(
  devBuild: boolean,
  consent: null | PluginConsent | undefined,
  manifest: PluginManifest,
): null | PluginConsent {
  if (devBuild) return null;
  const trust = pluginTrustOf(manifest);
  if (trust === null) return null;
  const request: PluginConsent = {
    capabilities: [...manifest.capabilities],
    trust,
  };
  return consentRequired(consent ?? undefined, request) === null
    ? null
    : request;
}

/**
 * §379 I4, the reverse direction — UX ONLY. Does a dev folder hold this id while a RELEASE
 * build's developer mode is on? Then install and update stop here, before the consent dialog
 * and the download, with the translated reason. The boundary is Rust's: the install commit
 * refuses a held id itself (`DEV_PLUGIN_ID_HELD`, judged on the committed manifest), so this
 * may miss a case without opening a hole.
 *
 * "Holds" = this session's list: a loadable folder's manifest id (`devPlugins`), or any id an
 * issue row carries (`devFolderIssues[].ids` — Rust's record, or a pick whose load threw).
 */
export function devFolderHoldsId(id: string): boolean {
  const { devFolderIssues, devMode, devPlugins } = usePluginStore.getState();
  if (!devMode.active || devMode.devBuild) return false;
  return (
    devPlugins[id] !== undefined ||
    devFolderIssues.some((issue) => issue.ids.includes(id))
  );
}

/**
 * Ask Rust for the developer list and load it: startup, and again after the developer-mode
 * switch moves. Throws when Rust does not answer — the caller decides what that means.
 */
export async function refreshDevPlugins(): Promise<void> {
  const snapshot = await pluginListDev();
  const store = usePluginStore.getState();
  store.setDevMode({
    active: snapshot.active,
    devBuild: snapshot.devBuild,
    enabled: snapshot.enabled,
  });
  const plugins: InstalledPlugin[] = [];
  const issues: DevFolderIssue[] = [];
  for (const row of snapshot.folders) {
    if (row.plugin) {
      const consent = devRowConsent(snapshot.devBuild, row);
      plugins.push(toInstalledDevPlugin(row.plugin, consent));
    } else {
      issues.push({ error: row.error ?? "", ids: row.ids, path: row.path });
    }
  }
  store.setDevPlugins(plugins);
  store.setDevFolderIssues(issues);
  await Promise.allSettled(
    plugins.map((plugin) => loadListed(plugin, snapshot.devBuild)),
  );
}

async function loadListed(
  plugin: InstalledPlugin,
  devBuild: boolean,
): Promise<void> {
  const { setError } = usePluginStore.getState();
  try {
    if (devConsentToAsk(devBuild, plugin.consent, plugin.manifest) !== null) {
      // Not loaded: asking happens on Reload, never unprompted at startup (plan 0106 P12).
      setError(plugin.manifest.id, tr("plugin.dev.error.consentNeeded"));
      return;
    }
    if (pluginLoader.isLoaded(plugin.manifest.id)) {
      // This id is already marked loaded (`this.loaded`, set only once a load FINISHES — see
      // `plugin-loader.ts`) before this call even starts, which happens two ways: (1) an
      // installed plugin of the same id loaded earlier in `initializePlugins` (spec R3) — this
      // really does replace it with the folder's own code; (2) this exact folder's plugin was
      // already loaded by an earlier `refreshDevPlugins` run in this session (the
      // developer-mode switch moved, or Reload ran again) — this reloads itself, nothing else
      // is "overridden".
      //
      // Two DIFFERENT folders sharing an id do NOT reach this branch within one call:
      // `plugins.map` starts every `loadListed` before any of them finishes, so `isLoaded` is
      // still false for the second one — its `pluginLoader.loadPlugin` call instead JOINS the
      // first folder's in-flight load (`plugin-loader.ts`'s own `inFlightLoads` map and its
      // own "already loading — joining that load" warning), which runs the FIRST folder's code
      // while the store above already recorded the LAST folder's row under that id. That
      // mismatch is a known gap this round does not fix.
      logger.warn(
        `[DevPlugins] dev plugin ${plugin.manifest.id} reloads an id that is already loaded`,
      );
      await pluginLoader.reloadPlugin(plugin.installPath, plugin.manifest, {
        devConsent: plugin.consent,
        isDev: true,
      });
    } else {
      await pluginLoader.loadPlugin(plugin.installPath, plugin.manifest, {
        devConsent: plugin.consent,
        isDev: true,
      });
    }
    // Clear any failure from a previous run: without this a one-off startup error outlives
    // the run that caused it.
    setError(plugin.manifest.id, null);
  } catch (err) {
    logger.error(`[DevPlugins] dev load failed ${plugin.manifest.id}:`, err);
    setError(plugin.manifest.id, String(err));
  }
}

/**
 * Stop every dev plugin this realm runs — developer mode was switched off (spec 0058 R2:
 * "끄면 dev 플러그인을 언로드한다"). Rust has already emptied the list it reports.
 */
export async function unloadDevPlugins(): Promise<void> {
  const { devPlugins } = usePluginStore.getState();
  for (const id of Object.keys(devPlugins)) {
    await pluginLoader.unloadPlugin(id);
  }
}

/** Same shape as the loader's `tr` — the startup path may run before the locale rehydrates. */
function tr(key: string, params?: Record<string, string>): string {
  return t(key, useSettingsStore.getState().locale as Locale, params);
}
