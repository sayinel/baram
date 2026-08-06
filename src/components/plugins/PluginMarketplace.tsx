// §69 Plugin Marketplace — Main sidebar panel with Browse / Installed / Updates tabs
//
// Shell only: tabs, search, the registry fetch, the revocation notices and detail routing.
// Every mutation lives in `usePluginActions`, and each tab's list is its own component.
import { useCallback, useEffect, useState } from "react";

import type { PluginRow } from "../../plugins/plugin-sources";
import type {
  PluginStatus,
  RegistryEntry,
  RegistryIndex,
} from "../../plugins/types";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
import { readFile } from "../../ipc/invoke";
import { BUILTIN_PLUGINS } from "../../plugins/builtin";
import { buildPluginRows } from "../../plugins/plugin-sources";
import {
  checkForUpdates,
  fetchRegistryIndex,
  searchRegistry,
} from "../../plugins/registry-client";
import { revocationFor } from "../../plugins/revocation";
import {
  refreshRevocations,
  revocationsAreStale,
} from "../../plugins/revocation-client";
import { usePluginStore } from "../../stores/system/plugin";
import { logger } from "../../utils/logger";
import { STYLES } from "./marketplace-styles";
import { PluginBrowseList } from "./PluginBrowseList";
import { PluginConsentDialog } from "./PluginConsentDialog";
import { PluginDetail } from "./PluginDetail";
import { PluginDeveloperSection } from "./PluginDeveloperSection";
import { PluginInstalledList } from "./PluginInstalledList";
import { getPluginStatus, usePluginActions } from "./usePluginActions";

type MarketplaceTab = "browse" | "installed" | "updates";

export function PluginMarketplace() {
  const { t } = useTranslation();
  const {
    builtinDisabled,
    installedPlugins,
    pluginErrors,
    updateAvailable,
    installing,
    revocations,
    revocationsFetchedAt,
    revocationsVerified,
  } = usePluginStore(
    useShallow((s) => ({
      builtinDisabled: s.builtinDisabled,
      installedPlugins: s.installedPlugins,
      installing: s.installing,
      pluginErrors: s.pluginErrors,
      revocations: s.revocations,
      revocationsFetchedAt: s.revocationsFetchedAt,
      revocationsVerified: s.revocationsVerified,
      updateAvailable: s.updateAvailable,
    })),
  );

  /**
   * One timestamp, captured at mount, for the staleness notice below.
   *
   * `Date.now()` in the render body is impure and the compiler rejects it. A live
   * clock buys nothing here anyway: the list is measured in days, and nobody keeps
   * the marketplace open long enough for the answer to change.
   */
  const [mountedAt] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState<MarketplaceTab>("browse");
  const [registryIndex, setRegistryIndex] = useState<null | RegistryIndex>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<null | RegistryEntry>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setFetchError] = useState<null | string>(null);
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

  // Load README for selected installed plugin
  useEffect(() => {
    if (!selectedEntry) {
      setReadme(null);
      return;
    }
    const plugin = installedPlugins[selectedEntry.id];
    if (!plugin) {
      setReadme(null);
      return;
    }
    let cancelled = false;
    readFile(`${plugin.installPath}/README.md`)
      .then((content) => {
        if (!cancelled) setReadme(content);
      })
      .catch(() => {
        if (!cancelled) setReadme(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEntry, installedPlugins]);

  // Fetch registry on mount
  useEffect(() => {
    // §69 — the spec asks for two refresh triggers, "app start + opening the
    // marketplace", and only the first was wired. A desktop editor stays open for days,
    // so a session that began offline would otherwise never pick up a new withdrawal —
    // nor a WITHDRAWAL OF A FALSE POSITIVE, which leaves a wrongly-blocked user with no
    // in-app remedy short of restarting.
    void refreshRevocations();
    setLoading(true);
    fetchRegistryIndex()
      .then((index) => {
        setRegistryIndex(index);
        setFetchError(null);
      })
      .catch((err) => setFetchError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  /**
   * The revocation a USER should be shown for this listing.
   *
   * Resolved against the INSTALLED version, not the registry's, and they diverge in
   * exactly the case the spec's own example describes: 2.0.0–2.0.3 revoked, fixed in
   * 2.0.4. The registry then offers a clean 2.0.4 while the user still runs 2.0.1, so
   * keying the display off `entry.version` showed nothing anywhere — no badge, no
   * notice — while the loader refused the plugin. That is precisely the "the user
   * thinks the app is broken" outcome the no-delete rule exists to avoid.
   *
   * `unlisted` is excluded here rather than at each call site: the spec says it must
   * not be surfaced at all, and a badge that opens a detail view explaining nothing is
   * worse than no badge.
   *
   * The install and update GATES deliberately do not use this — they decide about the
   * version being acquired, which is the registry's.
   */
  const shownRevocation = useCallback(
    (entry: RegistryEntry) => {
      const found = revocationFor(
        entry.id,
        installedPlugins[entry.id]?.manifest.version ?? entry.version,
        revocations,
      );
      return found?.severity === "unlisted" ? null : found;
    },
    [installedPlugins, revocations],
  );

  const filteredPlugins = registryIndex
    ? searchRegistry(registryIndex, searchQuery)
    : [];

  const rows = buildPluginRows({
    builtinDisabled,
    builtins: BUILTIN_PLUGINS,
    // dev 섹션은 아직 `PluginDeveloperSection`이 담당한다 (backlog). 행 모델에 넣지 않으므로
    // 셸은 부를 수 없는 `onReload`를 넘길 필요가 없다.
    devPlugins: {},
    installedPlugins,
    pluginErrors,
    revocations,
    updateAvailable,
  });

  const installedList = Object.values(installedPlugins);
  const updatesCount = Object.keys(updateAvailable).length;

  /**
   * The entries the Updates tab lists: an update is only offerable for a plugin that is
   * installed AND still listed, since the download comes from the listing.
   */
  const updateEntries = Object.keys(updateAvailable).flatMap((id) => {
    if (!installedPlugins[id]) return [];
    const entry = registryIndex?.plugins.find((p) => p.id === id);
    return entry ? [entry] : [];
  });

  // Force-refresh the registry (bypasses the 24h cache) and re-run the
  // update check against the fresh index. Shared by the always-available
  // header button and the error-state Retry button.
  const handleRefresh = useCallback(() => {
    setLoading(true);
    fetchRegistryIndex(true)
      .then(async (index) => {
        setRegistryIndex(index);
        setFetchError(null);
        try {
          await checkForUpdates();
        } catch (err) {
          logger.warn("[Marketplace] update check after refresh failed:", err);
        }
      })
      .catch((e) => setFetchError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Rendered by BOTH returns below: install can be started from the list or from the
  // detail view, and the detail view is an early return — mounting the dialog in only
  // one of them would leave the other's `askConsent` promise pending forever.
  const consentDialog = pendingConsent && (
    <PluginConsentDialog
      consent={pendingConsent.consent}
      intent={pendingConsent.intent}
      name={pendingConsent.name}
      onCancel={() => settleConsent(null)}
      onConfirm={() => settleConsent(pendingConsent.consent)}
      prior={pendingConsent.prior}
    />
  );

  // If detail view is showing
  if (selectedEntry) {
    const plugin = installedPlugins[selectedEntry.id];
    const detailStatus: PluginStatus = getPluginStatus(
      selectedEntry.id,
      installing,
      plugin,
    );
    return (
      <>
        {consentDialog}
        <PluginDetail
          entry={selectedEntry}
          error={pluginErrors[selectedEntry.id]}
          onBack={() => setSelectedEntry(null)}
          onInstall={() => handleInstall(selectedEntry)}
          onToggleEnabled={() => handleToggleEnabled(selectedEntry.id)}
          onUninstall={() => handleUninstall(selectedEntry.id)}
          onUpdate={() => handleUpdate(selectedEntry)}
          readme={readme}
          revocation={shownRevocation(selectedEntry)}
          status={detailStatus}
          updateAvailable={updateAvailable[selectedEntry.id]}
        />
      </>
    );
  }

  return (
    <div className="plugin-marketplace" style={STYLES.container}>
      {consentDialog}
      {/* Header */}
      <div style={STYLES.header}>
        <h2 style={STYLES.title}>{t("plugin.marketplace.title")}</h2>

        {/* Tabs */}
        <div style={STYLES.tabBar}>
          {(["browse", "installed", "updates"] as MarketplaceTab[]).map(
            (tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={
                  activeTab === tab
                    ? STYLES.tabButtonActive
                    : STYLES.tabButtonInactive
                }
              >
                {tab === "browse"
                  ? t("plugin.marketplace.tab.browse")
                  : tab === "installed"
                    ? t("plugin.marketplace.tab.installed", {
                        count: String(installedList.length),
                      })
                    : t("plugin.marketplace.tab.updates", {
                        count: String(updatesCount),
                      })}
              </button>
            ),
          )}
          {(activeTab === "browse" || activeTab === "updates") && (
            <button
              className="marketplace-refresh-btn"
              disabled={loading}
              onClick={handleRefresh}
              style={STYLES.refreshButton}
            >
              {loading
                ? t("plugin.marketplace.refreshing")
                : t("plugin.marketplace.refresh")}
            </button>
          )}
        </div>

        {/* Search (browse tab only) */}
        {activeTab === "browse" && (
          <input
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("plugin.marketplace.search")}
            style={STYLES.searchInput}
            type="text"
            value={searchQuery}
          />
        )}
      </div>

      {/* Content */}
      <div style={STYLES.content}>
        {/* §69 — the withdrawal list is applied from disk whether or not it can be
            refreshed, so going offline never costs protection. It does cost freshness,
            and that is worth saying rather than hiding: this informs, it gates
            nothing. */}
        {/* §69 — never received is a DIFFERENT state from old, and the one that
            matters most: it is what every user is in when the feature is broken rather
            than merely stale. Its absence is why a missing ACL grant — which disabled
            revocation entirely in every build — looked exactly like a normal
            marketplace for a whole review cycle. */}
        {revocationsFetchedAt === 0 && (
          <p className="plugin-revoked__note">{t("plugin.revoked.never")}</p>
        )}
        {/* ‼️ Says the list was never CHECKED, which is distinct from stale and from absent
            (security review MEDIUM-4). Without it a list that failed verification — or one from
            a registry we hold no key for — looked exactly like a freshly verified one:
            `revocationsFetchedAt` is stamped either way, so staleness stayed quiet. That is what
            made a redirected refresh undetectable. Gated on a list actually being stored, so it
            does not double up with the "never received" note above. */}
        {revocationsFetchedAt > 0 && !revocationsVerified && (
          <p className="plugin-revoked__note">
            {t("plugin.revoked.unverified")}
          </p>
        )}
        {revocationsAreStale(revocationsFetchedAt, mountedAt) && (
          <p className="plugin-revoked__note">
            {t("plugin.revoked.stale", {
              days: String(
                Math.floor(
                  (mountedAt - revocationsFetchedAt) / (24 * 60 * 60 * 1000),
                ),
              ),
            })}
          </p>
        )}
        {/* Error state */}
        {error && activeTab === "browse" && (
          <div style={STYLES.errorMessage}>
            <p>{t("plugin.marketplace.registryFailed")}</p>
            <p style={STYLES.errorSubtext}>{error}</p>
            <button
              disabled={loading}
              onClick={handleRefresh}
              style={STYLES.retryButton}
            >
              {t("plugin.action.retry")}
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && activeTab === "browse" && (
          <div style={STYLES.loadingMessage}>
            {t("plugin.marketplace.loading")}
          </div>
        )}

        {/* Browse tab */}
        {activeTab === "browse" &&
          !loading &&
          !error &&
          (filteredPlugins.length === 0 ? (
            <div style={STYLES.centeredMessage}>
              {searchQuery
                ? t("plugin.marketplace.emptySearch")
                : t("plugin.marketplace.emptyRegistry")}
            </div>
          ) : (
            <PluginBrowseList
              entries={filteredPlugins}
              installedPlugins={installedPlugins}
              installing={installing}
              onInstall={(entry) => void handleInstall(entry)}
              onSelect={setSelectedEntry}
              onUninstall={(id) => void handleUninstall(id)}
              onUpdate={(entry) => void handleUpdate(entry)}
              pluginErrors={pluginErrors}
              revoked={(entry) => shownRevocation(entry) !== null}
              updateAvailable={updateAvailable}
            />
          ))}

        {/* Installed tab */}
        {activeTab === "installed" &&
          (rows.length === 0 ? (
            <div style={STYLES.centeredMessage}>
              {t("plugin.marketplace.emptyInstalled")}
            </div>
          ) : (
            <PluginInstalledList
              onDetails={(r) => setSelectedEntry(entryFromRow(r))}
              onRemove={(r) => void handleUninstall(r.manifest.id)}
              onToggle={(r) =>
                r.source === "builtin"
                  ? handleToggleBuiltin(r.manifest.id, !r.enabled)
                  : handleToggleEnabled(r.manifest.id)
              }
              onUpdate={(r) => void handleUpdate(entryFromRow(r))}
              rows={rows}
            />
          ))}

        {/* Updates tab */}
        {activeTab === "updates" &&
          (updatesCount === 0 ? (
            <div style={STYLES.centeredMessage}>
              {t("plugin.marketplace.emptyUpdates")}
            </div>
          ) : (
            <PluginBrowseList
              entries={updateEntries}
              installedPlugins={installedPlugins}
              installing={installing}
              // ‼️ Unchanged from what this tab has always passed, and still a dead
              // callback: every card here is for an installed plugin, so `status` never
              // admits an Install button. Left exactly as it was rather than quietly
              // rewired — this commit's claim is that nothing about these handlers moved.
              onInstall={() => {}}
              onSelect={setSelectedEntry}
              onUninstall={(id) => void handleUninstall(id)}
              onUpdate={(entry) => void handleUpdate(entry)}
              pluginErrors={pluginErrors}
              revoked={(entry) => shownRevocation(entry) !== null}
              updateAvailable={updateAvailable}
            />
          ))}
      </div>

      <PluginDeveloperSection />
    </div>
  );
}

/**
 * 설치된 매니페스트로부터 상세 화면이 읽는 모양을 합성한다. `downloadUrl`은 비어
 * 있고, `handleUpdate`가 리스팅을 재해석하므로 그것을 신뢰하지 않는다.
 */
function entryFromRow(row: PluginRow): RegistryEntry {
  return {
    ...row.manifest,
    checksum: row.installed?.checksum ?? "",
    downloadUrl: "",
    downloads: undefined,
  };
}
