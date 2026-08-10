// §69 Plugin detail, hosted in the EDITOR AREA rather than inside the marketplace panel.
//
// Why a host rather than lifting `selected` out of `PluginMarketplace`: the detail is now
// reachable from a tab that outlives the panel that opened it — the sidebar can switch away
// and the settings modal closes on the way here — so a snapshot handed over at click time
// would go stale the moment the plugin is toggled, updated or removed. This component takes
// only the id and resolves everything live from the stores.
//
// Consequence worth stating: opening the detail for a plugin that is BOTH installed and
// listed shows the INSTALLED manifest. The marketplace's Browse/Updates route used to show
// the listing, i.e. the newer version. The Update affordance is unaffected — it comes from
// `updateAvailable`, and `handleUpdate` re-resolves the listing itself — so what changes is
// that the header reads the version you actually have.
import { useEffect, useState } from "react";

import type { RegistryIndex } from "../../plugins/types";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import {
  derivePluginSource,
  entryFromManifest,
  selectManifest,
} from "../../plugins/plugin-sources";
import { fetchRegistryIndex } from "../../plugins/registry-client";
import { revocationFor } from "../../plugins/revocation";
import { useEditorStore } from "../../stores/editor/editor";
import { usePluginStore } from "../../stores/system/plugin";
import { logger } from "../../utils/logger";
import { readPluginReadme } from "./plugin-readme";
import { PluginConsentDialog } from "./PluginConsentDialog";
import { PluginDetail } from "./PluginDetail";
import { getPluginStatus, usePluginActions } from "./usePluginActions";

export function PluginDetailTab({ pluginId }: { pluginId: string }) {
  const { t } = useTranslation();
  const {
    builtinDisabled,
    devPlugins,
    installedPlugins,
    installing,
    pluginErrors,
    revocations,
    updateAvailable,
  } = usePluginStore(
    useShallow((s) => ({
      builtinDisabled: s.builtinDisabled,
      devPlugins: s.devPlugins,
      installedPlugins: s.installedPlugins,
      installing: s.installing,
      pluginErrors: s.pluginErrors,
      revocations: s.revocations,
      updateAvailable: s.updateAvailable,
    })),
  );

  const [registryIndex, setRegistryIndex] = useState<null | RegistryIndex>(
    null,
  );
  /**
   * ‼️ Three states, not a nullable index. With only `registryIndex`, "the registry has not
   * answered yet" and "the registry says this plugin is gone" were the same value — so a
   * not-installed plugin flashed "no longer available" on its first paint, and a failed fetch
   * left that message up permanently, reporting a network fault as a withdrawn listing.
   */
  const [indexState, setIndexState] = useState<"failed" | "loading" | "ready">(
    "loading",
  );
  const [readme, setReadme] = useState<null | string>(null);

  const {
    handleInstall,
    handleToggleBuiltin,
    handleToggleEnabled,
    handleUninstall,
    handleUpdate,
    pendingConsent,
    settleConsent,
  } = usePluginActions(registryIndex);

  // Cached by `registry-client` (CACHE_DURATION), so this is normally not a network hop —
  // the marketplace has almost always fetched already. Needed even for an installed plugin:
  // `usePluginActions` resolves the listing out of it for Install and Update.
  useEffect(() => {
    let cancelled = false;
    fetchRegistryIndex()
      .then((index) => {
        if (cancelled) return;
        setRegistryIndex(index);
        setIndexState("ready");
      })
      .catch((err: unknown) => {
        logger.warn("[PluginDetailTab] registry fetch failed:", err);
        if (!cancelled) setIndexState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const installed = installedPlugins[pluginId] ?? devPlugins[pluginId];
  const manifest = selectManifest({ devPlugins, installedPlugins }, pluginId);
  const source = derivePluginSource({ devPlugins, installedPlugins }, pluginId);

  // ‼️ The tab TITLE was the one thing still snapshotted at click time, which contradicts this
  // component's whole premise. An update that renames the plugin left a stale label. Keyed on
  // the id rather than on `activeTabId`, so it addresses its own tab and not whichever is
  // focused.
  useEffect(() => {
    if (!manifest) return;
    const { setTabTitle, tabs } = useEditorStore.getState();
    const own = tabs.find(
      (t) => t.type === "plugin" && t.pluginId === pluginId,
    );
    if (own && own.title !== manifest.name) setTabTitle(own.id, manifest.name);
  }, [manifest, pluginId]);

  // Keyed on the PATH rather than on the `installed` object: the store hands back a fresh map
  // on any plugin write, so depending on the object identity re-read the README every time an
  // unrelated plugin was toggled. `undefined` means built-in — compiled in, nothing on disk.
  const installPath = installed?.installPath;
  useEffect(() => {
    if (installPath === undefined) {
      setReadme(null);
      return;
    }
    let cancelled = false;
    readPluginReadme(installPath)
      .then((content) => {
        if (!cancelled) setReadme(content);
      })
      .catch(() => {
        if (!cancelled) setReadme(null);
      });
    return () => {
      cancelled = true;
    };
  }, [installPath]);

  // The listing is the fallback, not the preference: it is the only source for a plugin the
  // user has not installed, which is also the only case where `downloadUrl` matters.
  const entry = manifest
    ? entryFromManifest(manifest, installed?.checksum)
    : registryIndex?.plugins.find((p) => p.id === pluginId);

  if (!entry) {
    // Nothing rather than a claim: the registry has not answered, so neither message is true
    // yet. An installed plugin never reaches this — its entry comes from the manifest.
    if (indexState === "loading") return null;
    return (
      <div className="plugin-detail-tab-empty">
        {t(
          indexState === "failed"
            ? "plugin.detail.registryUnreachable"
            : "plugin.detail.unavailable",
        )}
      </div>
    );
  }

  const isBuiltin = source === "builtin";
  const builtinEnabled = !builtinDisabled.includes(pluginId);
  // ‼️ A built-in has no INSTALL state to report — it is compiled in — so its status is
  // whether the user has it switched on. `getPluginStatus` reads `installedPlugins`, which
  // never contains one, and answered "not-installed" for every built-in.
  const status = isBuiltin
    ? builtinEnabled
      ? "enabled"
      : "disabled"
    : getPluginStatus(pluginId, installing, installedPlugins[pluginId]);

  return (
    <>
      {pendingConsent && (
        <PluginConsentDialog
          consent={pendingConsent.consent}
          intent={pendingConsent.intent}
          name={pendingConsent.name}
          onCancel={() => settleConsent(null)}
          onConfirm={() => settleConsent(pendingConsent.consent)}
          prior={pendingConsent.prior}
        />
      )}
      <PluginDetail
        entry={entry}
        error={pluginErrors[pluginId]}
        onBack={() => {
          // In a tab there is no "back" — closing is the way out. Resolved at click time
          // because the tab id is not this component's input.
          const { activeTabId, closeTab } = useEditorStore.getState();
          if (activeTabId) closeTab(activeTabId);
        }}
        onInstall={() => handleInstall(entry)}
        onToggleEnabled={() =>
          isBuiltin
            ? handleToggleBuiltin(pluginId, !builtinEnabled)
            : handleToggleEnabled(pluginId)
        }
        onUninstall={() => handleUninstall(pluginId)}
        onUpdate={() => handleUpdate(entry)}
        readme={readme}
        revocation={revocationFor(
          pluginId,
          // ‼️ Falls back to the LISTING's version when nothing is installed, matching the
          // panel's `shownRevocation`. Passing `null` for a not-installed plugin meant the
          // Browse list drew a revoked badge and the detail it links to explained nothing,
          // while offering an Install button — on the one screen whose job is provenance.
          // (`unlisted` severity is filtered by `PluginRevokedNotice` itself, and the install
          // gate judges independently in `usePluginActions`.)
          installed?.manifest.version ?? entry.version,
          revocations,
        )}
        source={source}
        status={status}
        updateAvailable={updateAvailable[pluginId]}
      />
    </>
  );
}
