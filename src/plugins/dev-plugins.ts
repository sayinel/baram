// §379 — the dev folders Rust lists (`plugin_list_dev`), loaded the way this build allows.
//
// A dev build loads every listed folder as before §379: unbounded, unrevoked, unasked. A release
// build loads a folder only in developer mode and only when the consent Rust recorded still
// covers what its manifest asks; the rest stay listed with a "press Reload" error, because Reload
// is where the Developer section asks (`use-dev-plugin-actions.ts`).
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
  const issues: { error: string; ids: string[]; path: string }[] = [];
  for (const row of snapshot.folders) {
    if (row.plugin) plugins.push(toInstalledDevPlugin(row.plugin, row.consent));
    else issues.push({ error: row.error ?? "", ids: row.ids, path: row.path });
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
  if (devConsentToAsk(devBuild, plugin.consent, plugin.manifest) !== null) {
    // Not loaded: asking happens on Reload, never unprompted at startup (plan 0106 P12).
    setError(plugin.manifest.id, tr("plugin.dev.error.consentNeeded"));
    return;
  }
  try {
    if (pluginLoader.isLoaded(plugin.manifest.id)) {
      // Reachable two ways: in a dev build a folder may stand in for an installed plugin of
      // the same id (spec R3), and in either build two listed folders may declare the same
      // id — the later one then replaces the earlier (the store keeps one record per id).
      logger.warn(
        `[DevPlugins] dev plugin ${plugin.manifest.id} overrides installed`,
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

/** Same shape as the loader's `tr` — the startup path may run before the locale rehydrates. */
function tr(key: string, params?: Record<string, string>): string {
  return t(key, useSettingsStore.getState().locale as Locale, params);
}
