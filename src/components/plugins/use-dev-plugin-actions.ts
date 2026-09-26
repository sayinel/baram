// §379 — what the Developer section can do: load, reload, remove, and switch developer mode.
//
// A `.ts` rather than a `.tsx` for the reason `usePluginActions.ts` gives: the consent dialog's
// JSX stays in the section, driven by `pendingConsent` / `settleConsent`.
//
// ‼️ A release build asks before a folder's code runs, and the answer is recorded in RUST
// (`plugin_record_dev_consent`) BEFORE the load. The loader narrows by the consent it is
// handed, and startup hands it what Rust holds — a consent that lived only in this hook would
// be gone after a restart, and the folder would not load at all (F2).
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  DevFolderRow,
  RustInstalledPluginInfo,
} from "../../ipc/plugin-invoke";
import type { InstalledPlugin, PluginConsent } from "../../plugins/types";

import { useTranslation } from "../../i18n/useTranslation";
import { describeDevError } from "../../ipc/plugin-dev-errors";
import {
  pluginPickDevFolder,
  pluginRecordDevConsent,
  pluginReloadDevFolder,
  pluginRemoveDevFolder,
  pluginSetDeveloperMode,
  toInstalledDevPlugin,
} from "../../ipc/plugin-invoke";
import {
  devConsentToAsk,
  refreshDevPlugins,
  unloadDevPlugins,
} from "../../plugins/dev-plugins";
import { pluginLoader } from "../../plugins/plugin-loader";
import { usePluginStore } from "../../stores/system/plugin";
import { useUIStore } from "../../stores/ui/ui";

type LoadableRow = DevFolderRow & { plugin: RustInstalledPluginInfo };

/** What the consent dialog is asking about for a dev folder. */
interface PendingDevConsent {
  consent: PluginConsent;
  name: string;
  prior?: PluginConsent;
}

export function useDevPluginActions() {
  const { t } = useTranslation();
  const [pendingConsent, setPendingConsent] =
    useState<null | PendingDevConsent>(null);
  // In a ref, not state: settling must not wait for a re-render (same as `usePluginActions`).
  const resolver = useRef<((granted: boolean) => void) | null>(null);

  const settleConsent = useCallback((granted: boolean) => {
    setPendingConsent(null);
    resolver.current?.(granted);
    resolver.current = null;
  }, []);

  // A dialog that disappears with the section is a refusal — never a consent.
  useEffect(
    () => () => {
      resolver.current?.(false);
      resolver.current = null;
    },
    [],
  );

  const askConsent = useCallback(
    (pending: PendingDevConsent) =>
      new Promise<boolean>((resolve) => {
        // A second request would strand the first caller; refuse the older one.
        resolver.current?.(false);
        resolver.current = resolve;
        setPendingConsent(pending);
      }),
    [],
  );

  /**
   * The plugin to load, carrying the consent it loads under — or `null` when the user
   * declined. A dev build never asks (`devConsentToAsk` answers `null` there).
   */
  const admit = useCallback(
    async (row: LoadableRow): Promise<InstalledPlugin | null> => {
      const plugin = toInstalledDevPlugin(row.plugin, row.consent);
      const request = devConsentToAsk(
        usePluginStore.getState().devMode.devBuild,
        row.consent,
        plugin.manifest,
      );
      if (request === null) return plugin;
      const granted = await askConsent({
        consent: request,
        name: plugin.manifest.name,
        ...(row.consent ? { prior: row.consent } : {}),
      });
      if (!granted) return null;
      await pluginRecordDevConsent(row.path, request);
      return { ...plugin, consent: request };
    },
    [askConsent],
  );

  const handleLoad = useCallback(async () => {
    const { showToast } = useUIStore.getState();
    // Set once the pick has put the folder on Rust's list. From then on a failure leaves an
    // issue row rather than nothing: the folder IS listed, and in a release build it may
    // already hold an id (verification pass, M2b).
    let picked: DevFolderRow | null = null;
    try {
      picked = await pluginPickDevFolder();
      if (picked === null) return;
      const row = picked;
      if (row.plugin === null) {
        listAsIssue(row, row.error ?? "");
        showToast(
          t("plugin.dev.toast.loadFailed", {
            error: describeDevError(row.error, t),
          }),
        );
        return;
      }
      // "Listed before" means either kind of row — a re-picked issue-row folder must not be
      // removed on decline either (P13).
      const { devFolderIssues, devPlugins } = usePluginStore.getState();
      const known =
        Object.values(devPlugins).some((p) => p.installPath === row.path) ||
        devFolderIssues.some((issue) => issue.path === row.path);
      const plugin = await admit({ ...row, plugin: row.plugin });
      if (plugin === null) {
        // Declined on a first pick: the pick already put the folder on Rust's list, so take
        // it back off. A folder that was listed before stays (plan 0106 P13).
        if (!known) await pluginRemoveDevFolder(row.path);
        return;
      }
      // `isDev` is DECLARED, not inferred (§260 Phase 5 re-review, G1): `addDevPlugin` runs
      // after the load, deliberately, so a failing load leaves no plugin card.
      await pluginLoader.loadPlugin(plugin.installPath, plugin.manifest, {
        devConsent: plugin.consent,
        isDev: true,
      });
      const store = usePluginStore.getState();
      store.addDevPlugin(plugin);
      // A folder that was an issue row and now loads is a plugin row, not both.
      store.setDevFolderIssues(
        store.devFolderIssues.filter((issue) => issue.path !== row.path),
      );
      // §260 3c-3 — a load that SUCCEEDS clears the last failure.
      store.setError(plugin.manifest.id, null);
      showToast(t("plugin.dev.toast.loaded", { name: plugin.manifest.name }));
    } catch (err) {
      if (picked !== null) {
        listAsIssue(picked, err instanceof Error ? err.message : String(err));
      }
      showToast(
        t("plugin.dev.toast.loadFailed", { error: describeDevError(err, t) }),
      );
    }
  }, [admit, t]);

  const handleReload = useCallback(
    async (plugin: InstalledPlugin) => {
      const { showToast } = useUIStore.getState();
      const { addDevPlugin, setError } = usePluginStore.getState();
      try {
        const row = await pluginReloadDevFolder(plugin.installPath);
        if (row.plugin === null) {
          const message = describeDevError(row.error, t);
          setError(plugin.manifest.id, message);
          showToast(t("plugin.dev.toast.reloadFailed", { error: message }));
          return;
        }
        const fresh = await admit({ ...row, plugin: row.plugin });
        if (fresh === null) {
          setError(plugin.manifest.id, t("plugin.dev.error.consentNeeded"));
          return;
        }
        await pluginLoader.reloadPlugin(fresh.installPath, fresh.manifest, {
          devConsent: fresh.consent,
          isDev: true,
        });
        addDevPlugin(fresh);
        setError(fresh.manifest.id, null);
        showToast(
          t("plugin.dev.toast.reloaded", { name: fresh.manifest.name }),
        );
      } catch (err) {
        const message = describeDevError(err, t);
        setError(plugin.manifest.id, message);
        showToast(t("plugin.dev.toast.reloadFailed", { error: message }));
      }
    },
    [admit, t],
  );

  /** Remove a folder from Rust's list; unload its plugin when there is one. */
  const handleRemove = useCallback(
    async (path: string, plugin?: InstalledPlugin) => {
      const { showToast } = useUIStore.getState();
      try {
        await pluginRemoveDevFolder(path);
        const { devFolderIssues, removeDevPlugin, setDevFolderIssues } =
          usePluginStore.getState();
        setDevFolderIssues(devFolderIssues.filter((i) => i.path !== path));
        if (plugin) {
          await pluginLoader.unloadPlugin(plugin.manifest.id);
          removeDevPlugin(plugin.manifest.id);
          showToast(
            t("plugin.dev.toast.removed", { name: plugin.manifest.name }),
          );
        }
      } catch (err) {
        showToast(
          t("plugin.dev.toast.removeFailed", {
            error: describeDevError(err, t),
          }),
        );
      }
    },
    [t],
  );

  const handleToggleMode = useCallback(
    async (next: boolean) => {
      try {
        const enabled = await pluginSetDeveloperMode(next);
        // Off means the folders' code stops now, not at the next launch.
        if (!enabled) await unloadDevPlugins();
        await refreshDevPlugins();
      } catch (err) {
        useUIStore.getState().showToast(
          t("plugin.dev.toast.modeFailed", {
            error: describeDevError(err, t),
          }),
        );
      }
    },
    [t],
  );

  return {
    handleLoad,
    handleReload,
    handleRemove,
    handleToggleMode,
    pendingConsent,
    settleConsent,
  };
}

/**
 * Show a folder that is on Rust's list but did not load as an issue row, carrying the ids it
 * holds — so the install flow's early refusal (`devFolderHoldsId`) sees it too. Keyed
 * by path: a second failure replaces the first.
 */
function listAsIssue(row: DevFolderRow, error: string): void {
  const { devFolderIssues, setDevFolderIssues } = usePluginStore.getState();
  setDevFolderIssues([
    ...devFolderIssues.filter((issue) => issue.path !== row.path),
    { error, ids: row.ids, path: row.path },
  ]);
}
