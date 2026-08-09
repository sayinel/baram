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
        if (!cancelled) setRegistryIndex(index);
      })
      .catch((err: unknown) => {
        logger.warn("[PluginDetailTab] registry fetch failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const installed = installedPlugins[pluginId] ?? devPlugins[pluginId];
  const manifest = selectManifest({ devPlugins, installedPlugins }, pluginId);
  const source = derivePluginSource({ devPlugins, installedPlugins }, pluginId);

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
    // Reachable while the fetch is in flight for a not-installed plugin, and permanently if
    // its listing was withdrawn between opening the tab and this render.
    return (
      <div className="plugin-detail-tab-empty">
        {t("plugin.detail.unavailable")}
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
        revocation={
          installed
            ? revocationFor(pluginId, installed.manifest.version, revocations)
            : null
        }
        source={source}
        status={status}
        updateAvailable={updateAvailable[pluginId]}
      />
    </>
  );
}
