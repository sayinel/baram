// §69 Plugin Marketplace — Main sidebar panel with Browse / Installed / Updates tabs
import React, { useCallback, useEffect, useRef, useState } from "react";

// Module-level style constants — avoids creating new object references on every render
const STYLES = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
  } as React.CSSProperties,
  header: { padding: "12px 16px 0" } as React.CSSProperties,
  title: {
    margin: "0 0 12px",
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--color-text-primary)",
  } as React.CSSProperties,
  tabBar: {
    display: "flex",
    gap: "0",
    borderBottom: "1px solid var(--color-border-default)",
    marginBottom: "8px",
  } as React.CSSProperties,
  searchInput: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "6px",
    fontSize: "13px",
    border: "1px solid var(--color-border-default)",
    backgroundColor: "var(--color-bg-default)",
    color: "var(--color-text-primary)",
    outline: "none",
    boxSizing: "border-box",
    marginBottom: "8px",
  } as React.CSSProperties,
  content: { flex: 1, overflowY: "auto" } as React.CSSProperties,
  centeredMessage: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--color-text-muted)",
    fontSize: "13px",
  } as React.CSSProperties,
  errorMessage: {
    padding: "16px",
    textAlign: "center",
    color: "var(--color-text-muted)",
    fontSize: "13px",
  } as React.CSSProperties,
  errorSubtext: { fontSize: "12px", opacity: 0.7 } as React.CSSProperties,
  retryButton: {
    marginTop: "8px",
    padding: "6px 12px",
    borderRadius: "6px",
    fontSize: "12px",
    cursor: "pointer",
    backgroundColor: "var(--color-accent-default)",
    color: "#fff",
    border: "none",
  } as React.CSSProperties,
  loadingMessage: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--color-text-muted)",
    fontSize: "13px",
  } as React.CSSProperties,
  installedRow: {
    borderBottom: "1px solid var(--color-border-default)",
  } as React.CSSProperties,
  installedRowInner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 16px",
  } as React.CSSProperties,
  installedRowInfo: { flex: 1, minWidth: 0 } as React.CSSProperties,
  installedRowNameRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  } as React.CSSProperties,
  installedPluginName: {
    fontWeight: 600,
    fontSize: "14px",
    color: "var(--color-text-primary)",
  } as React.CSSProperties,
  installedPluginVersion: {
    fontSize: "12px",
    color: "var(--color-text-muted)",
  } as React.CSSProperties,
  installedPluginError: {
    fontSize: "11px",
    color: "var(--color-status-danger)",
    fontWeight: 500,
  } as React.CSSProperties,
  installedPluginDescription: {
    margin: "2px 0 0",
    fontSize: "12px",
    color: "var(--color-text-secondary)",
  } as React.CSSProperties,
  installedRowActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexShrink: 0,
  } as React.CSSProperties,
  updateButton: {
    padding: "4px 12px",
    borderRadius: "4px",
    fontSize: "12px",
    backgroundColor: "#f59e0b",
    color: "#fff",
    border: "none",
    cursor: "pointer",
  } as React.CSSProperties,
  toggleLabel: {
    display: "flex",
    alignItems: "center",
    cursor: "pointer",
  } as React.CSSProperties,
  toggleCheckbox: { marginRight: "4px" } as React.CSSProperties,
  toggleText: {
    fontSize: "12px",
    color: "var(--color-text-muted)",
  } as React.CSSProperties,
  removeButton: {
    padding: "4px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    backgroundColor: "transparent",
    color: "var(--color-status-danger)",
    border: "1px solid var(--color-status-danger)",
    cursor: "pointer",
  } as React.CSSProperties,
  tabButtonActive: {
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--color-accent-default)",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    borderBottom: "2px solid var(--color-accent-default)",
    marginBottom: "-1px",
  } as React.CSSProperties,
  tabButtonInactive: {
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: 400,
    color: "var(--color-text-muted)",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    marginBottom: "-1px",
  } as React.CSSProperties,
  refreshButton: {
    marginLeft: "auto",
    marginBottom: "-1px",
    padding: "6px 12px",
    fontSize: "12px",
    backgroundColor: "transparent",
    border: "none",
  } as React.CSSProperties,
};

import type { ConsentReason } from "../../plugins/plugin-consent";
import type {
  InstalledPlugin,
  PluginConsent,
  PluginStatus,
  RegistryEntry,
  RegistryIndex,
} from "../../plugins/types";

import { useShallow } from "zustand/shallow";

import { readFile } from "../../ipc/invoke";
import { pluginInstall, pluginUninstall } from "../../ipc/plugin-invoke";
import { validateManifest } from "../../plugins/manifest";
import { consentGaps, consentRequired } from "../../plugins/plugin-consent";
import { pluginLoader } from "../../plugins/plugin-loader";
import {
  checkForUpdates,
  fetchRegistryIndex,
  searchRegistry,
} from "../../plugins/registry-client";
import { usePluginStore } from "../../stores/system/plugin";
import { logger } from "../../utils/logger";
import { PluginCard } from "./PluginCard";
import { PluginConsentDialog } from "./PluginConsentDialog";
import { PluginDetail } from "./PluginDetail";
import { PluginDeveloperSection } from "./PluginDeveloperSection";
import { PluginSettingsForm } from "./PluginSettingsForm";

type MarketplaceTab = "browse" | "installed" | "updates";

/**
 * §260 Phase 5 — the live registry still lists plugins written before the trust model
 * (both entries, as of 2026-07-16). `validateManifest` refuses a trust-less manifest, so
 * without this the user downloads first and meets a validation error second.
 */
const LEGACY_ENTRY_MESSAGE =
  "This plugin predates Baram's plugin trust model and cannot be installed. " +
  "Ask the author to publish a manifest that declares a trust tier.";

/** What the consent dialog is currently asking about, if anything. */
interface PendingConsent {
  consent: PluginConsent;
  name: string;
  prior?: PluginConsent;
  reason: ConsentReason;
}

export function PluginMarketplace() {
  const {
    installedPlugins,
    pluginErrors,
    updateAvailable,
    installing,
    addPlugin,
    removePlugin,
    setEnabled,
    setError,
    setInstalling,
    clearUpdateAvailable,
  } = usePluginStore(
    useShallow((s) => ({
      addPlugin: s.addPlugin,
      clearUpdateAvailable: s.clearUpdateAvailable,
      installedPlugins: s.installedPlugins,
      installing: s.installing,
      pluginErrors: s.pluginErrors,
      removePlugin: s.removePlugin,
      setEnabled: s.setEnabled,
      setError: s.setError,
      setInstalling: s.setInstalling,
      updateAvailable: s.updateAvailable,
    })),
  );

  const [activeTab, setActiveTab] = useState<MarketplaceTab>("browse");
  /** Plugin ids whose enable/disable is in flight — see `handleToggleEnabled`. */
  const togglingRef = useRef<Set<string>>(new Set());
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

  // §260 Phase 5 — the install flow awaits a decision, so the dialog is modelled as a
  // promise the user resolves. The resolver lives in a ref rather than in state because
  // settling it must not depend on a re-render having happened first.
  const [pendingConsent, setPendingConsent] = useState<null | PendingConsent>(
    null,
  );
  const consentResolver = useRef<((v: null | PluginConsent) => void) | null>(
    null,
  );

  const askConsent = useCallback(
    (pending: PendingConsent) =>
      new Promise<null | PluginConsent>((resolve) => {
        // A second request while one is open would strand the first caller forever.
        // Refuse the older one rather than leaking a never-settled promise.
        consentResolver.current?.(null);
        consentResolver.current = resolve;
        setPendingConsent(pending);
      }),
    [],
  );

  const settleConsent = useCallback((value: null | PluginConsent) => {
    setPendingConsent(null);
    consentResolver.current?.(value);
    consentResolver.current = null;
  }, []);

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
    setLoading(true);
    fetchRegistryIndex()
      .then((index) => {
        setRegistryIndex(index);
        setFetchError(null);
      })
      .catch((err) => setFetchError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  const filteredPlugins = registryIndex
    ? searchRegistry(registryIndex, searchQuery)
    : [];

  const installedList = Object.values(installedPlugins);
  const updatesCount = Object.keys(updateAvailable).length;

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

  /**
   * \u00a7260 Phase 5 \u2014 consent, then download, then VERIFY the download against what was
   * consented to.
   *
   * Consent is collected against the registry entry, which is a claim the registry
   * makes. The manifest inside the ZIP is the truth. Checking that they agree is what
   * makes the claim worth consenting to at all: otherwise a registry (or a swapped
   * download URL that still matches its checksum entry) could advertise "sandboxed" and
   * ship "trusted", and the user would have approved the wrong thing.
   *
   * Every check runs BEFORE `addPlugin`. That also closes a gap this flow has carried
   * since \u00a769: the record used to be persisted first and validated only inside
   * `loadPlugin`, whose rejection merely set an error string \u2014 so an invalid manifest
   * stayed in the store, and a plugin declaring `tiptapExtensions` skipped `loadPlugin`
   * entirely and was never validated at all.
   *
   * `preApproved` is for the update path, which has already asked.
   */
  const handleInstall = useCallback(
    async (entry: RegistryEntry, preApproved?: PluginConsent) => {
      if (!entry.trust) {
        setError(entry.id, LEGACY_ENTRY_MESSAGE);
        return;
      }
      const claimed: PluginConsent = {
        capabilities: [...entry.capabilities].sort(),
        trust: entry.trust,
      };
      const consent =
        preApproved ??
        (await askConsent({
          consent: claimed,
          name: entry.name,
          reason: "first-install",
        }));
      if (!consent) return;

      setInstalling(entry.id, true);
      try {
        const result = await pluginInstall(entry.downloadUrl, entry.checksum);
        // Roll back to the id the archive actually installed under \u2014 that is where the
        // files landed, whatever the registry called the entry.
        const reject = async (why: string): Promise<never> => {
          await pluginUninstall(result.manifest.id).catch((err: unknown) =>
            logger.error("[Marketplace] rollback failed:", err),
          );
          throw new Error(why);
        };

        const validation = validateManifest(result.manifest);
        if (!validation.valid) {
          await reject(
            `the downloaded manifest is invalid \u2014 ${validation.errors
              .map((e) => `${e.field}: ${e.message}`)
              .join("; ")}`,
          );
        }
        if (result.manifest.id !== entry.id) {
          await reject(
            `the download declares id "${result.manifest.id}" but the registry listed "${entry.id}"`,
          );
        }
        const gaps = consentGaps(consent, {
          capabilities: result.manifest.capabilities,
          trust: result.manifest.trust,
        });
        if (gaps.length > 0) {
          await reject(
            `the download does not match the registry listing \u2014 ${gaps.join("; ")}`,
          );
        }

        const plugin: InstalledPlugin = {
          checksum: result.checksum,
          consent,
          enabled: true,
          installedAt: Date.now(),
          installPath: result.install_path,
          manifest: result.manifest,
          updatedAt: Date.now(),
        };
        addPlugin(plugin);
        setError(entry.id, null);

        // Load the plugin if it doesn't have tiptap extensions (those need restart)
        if (!result.manifest.tiptapExtensions?.length) {
          await pluginLoader.loadPlugin(result.install_path, result.manifest);
        }
      } catch (err) {
        setError(entry.id, String(err));
      } finally {
        setInstalling(entry.id, false);
      }
    },
    [addPlugin, askConsent, setError, setInstalling],
  );

  const handleUninstall = useCallback(
    async (id: string) => {
      try {
        await pluginLoader.unloadPlugin(id);
        await pluginUninstall(id);
        removePlugin(id);
      } catch (err) {
        setError(id, String(err));
      }
    },
    [removePlugin, setError],
  );

  const handleUpdate = useCallback(
    async (entry: RegistryEntry) => {
      if (!entry.trust) {
        setError(entry.id, LEGACY_ENTRY_MESSAGE);
        return;
      }
      // \u00a7260 Phase 5 \u2014 read the recorded consent BEFORE uninstalling: `handleUninstall`
      // calls `removePlugin`, which deletes the very record this compares against.
      // Without that ordering an update would always look like a first install.
      const prior = installedPlugins[entry.id]?.consent;
      const claimed: PluginConsent = {
        capabilities: [...entry.capabilities].sort(),
        trust: entry.trust,
      };
      const reason = consentRequired(prior, claimed);
      // When the recorded consent already covers this version, record the CLAIMED shape
      // rather than carrying the old one forward \u2014 an update that drops a capability
      // must narrow the record too, or the grant outlives the version that needed it.
      const consent =
        reason === null
          ? claimed
          : await askConsent({
              consent: claimed,
              name: entry.name,
              prior,
              reason,
            });
      if (!consent) return;

      await handleUninstall(entry.id);
      await handleInstall(entry, consent);
      clearUpdateAvailable(entry.id);
    },
    [
      askConsent,
      clearUpdateAvailable,
      handleInstall,
      handleUninstall,
      installedPlugins,
      setError,
    ],
  );

  const handleToggleEnabled = useCallback(
    (id: string) => {
      const plugin = installedPlugins[id];
      if (!plugin) return;
      // §260 3c-3 review (M5) — one toggle at a time. The store flips immediately, so
      // a second click read the ALREADY-flipped value and called `unloadPlugin` while
      // the load was still in flight; that unload early-returned (nothing in `loaded`
      // yet), the load then completed, and the session ended with a running, granted
      // sandbox that the UI showed as disabled and nothing would ever tear down.
      if (togglingRef.current.has(id)) return;
      togglingRef.current.add(id);
      const done = () => togglingRef.current.delete(id);

      const newEnabled = !plugin.enabled;
      setEnabled(id, newEnabled);
      if (newEnabled) {
        pluginLoader
          .loadPlugin(plugin.installPath, plugin.manifest)
          .then(
            // Clear the previous failure once the plugin loads. Same defect as the
            // dev-plugin card: the error was written on failure and never removed, so
            // a plugin the user has since fixed kept displaying why it once failed.
            () => setError(id, null),
            (err: unknown) => {
              setError(id, String(err));
              setEnabled(id, false);
            },
          )
          .finally(done);
      } else {
        // `unloadPlugin` swallows a failed teardown by design (`unloadAll` must keep
        // going) and reports it through `pluginErrors` itself — see the loader. This
        // catch covers what still propagates: a synchronous throw from `teardown()`
        // or from the UI sweep. Roll `enabled` back then, so the store never claims
        // a plugin is off while it is still loaded (M3/L4).
        pluginLoader
          .unloadPlugin(id)
          .catch((err: unknown) => {
            setError(id, String(err));
            setEnabled(id, true);
          })
          .finally(done);
      }
    },
    [installedPlugins, setEnabled, setError],
  );

  // Rendered by BOTH returns below: install can be started from the list or from the
  // detail view, and the detail view is an early return — mounting the dialog in only
  // one of them would leave the other's `askConsent` promise pending forever.
  const consentDialog = pendingConsent && (
    <PluginConsentDialog
      consent={pendingConsent.consent}
      name={pendingConsent.name}
      onCancel={() => settleConsent(null)}
      onConfirm={() => settleConsent(pendingConsent.consent)}
      prior={pendingConsent.prior}
      reason={pendingConsent.reason}
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
        <h2 style={STYLES.title}>Plugins</h2>

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
                  ? "Browse"
                  : tab === "installed"
                    ? `Installed (${installedList.length})`
                    : `Updates (${updatesCount})`}
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
              {loading ? "↻ Refreshing…" : "↻ Refresh"}
            </button>
          )}
        </div>

        {/* Search (browse tab only) */}
        {activeTab === "browse" && (
          <input
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search plugins..."
            style={STYLES.searchInput}
            type="text"
            value={searchQuery}
          />
        )}
      </div>

      {/* Content */}
      <div style={STYLES.content}>
        {/* Error state */}
        {error && activeTab === "browse" && (
          <div style={STYLES.errorMessage}>
            <p>Failed to load registry</p>
            <p style={STYLES.errorSubtext}>{error}</p>
            <button
              disabled={loading}
              onClick={handleRefresh}
              style={STYLES.retryButton}
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && activeTab === "browse" && (
          <div style={STYLES.loadingMessage}>Loading plugins...</div>
        )}

        {/* Browse tab */}
        {activeTab === "browse" &&
          !loading &&
          !error &&
          (filteredPlugins.length === 0 ? (
            <div style={STYLES.centeredMessage}>
              {searchQuery ? "No plugins found" : "No plugins available"}
            </div>
          ) : (
            filteredPlugins.map((entry) => {
              const cardPlugin = installedPlugins[entry.id];
              const cardStatus: PluginStatus = getPluginStatus(
                entry.id,
                installing,
                cardPlugin,
              );
              return (
                <PluginCard
                  entry={entry}
                  error={pluginErrors[entry.id]}
                  key={entry.id}
                  onInstall={() => handleInstall(entry)}
                  onSelect={() => setSelectedEntry(entry)}
                  onUninstall={() => handleUninstall(entry.id)}
                  onUpdate={() => handleUpdate(entry)}
                  status={cardStatus}
                  updateAvailable={updateAvailable[entry.id]}
                />
              );
            })
          ))}

        {/* Installed tab */}
        {activeTab === "installed" &&
          (installedList.length === 0 ? (
            <div style={STYLES.centeredMessage}>No plugins installed</div>
          ) : (
            installedList.map((plugin) => {
              const entry: RegistryEntry = {
                ...plugin.manifest,
                downloadUrl: "",
                checksum: plugin.checksum,
                downloads: undefined,
              };
              return (
                <div key={plugin.manifest.id} style={STYLES.installedRow}>
                  <div style={STYLES.installedRowInner}>
                    <div style={STYLES.installedRowInfo}>
                      <div style={STYLES.installedRowNameRow}>
                        <span style={STYLES.installedPluginName}>
                          {plugin.manifest.name}
                        </span>
                        <span style={STYLES.installedPluginVersion}>
                          v{plugin.manifest.version}
                        </span>
                        {pluginErrors[plugin.manifest.id] && (
                          <span style={STYLES.installedPluginError}>Error</span>
                        )}
                      </div>
                      <p style={STYLES.installedPluginDescription}>
                        {plugin.manifest.description}
                      </p>
                    </div>
                    <div style={STYLES.installedRowActions}>
                      {updateAvailable[plugin.manifest.id] && (
                        <button
                          onClick={() => handleUpdate(entry)}
                          style={STYLES.updateButton}
                        >
                          Update
                        </button>
                      )}
                      <label style={STYLES.toggleLabel}>
                        <input
                          checked={plugin.enabled}
                          onChange={() =>
                            handleToggleEnabled(plugin.manifest.id)
                          }
                          style={STYLES.toggleCheckbox}
                          type="checkbox"
                        />
                        <span style={STYLES.toggleText}>
                          {plugin.enabled ? "On" : "Off"}
                        </span>
                      </label>
                      <button
                        onClick={() => handleUninstall(plugin.manifest.id)}
                        style={STYLES.removeButton}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {/* §260 Phase 4c — configured HERE as well as in the detail view. This
                      tab has no route to `PluginDetail` (only Browse and Updates open one,
                      and both iterate the REGISTRY), so a plugin installed from a file, or
                      one whose registry entry has gone, would otherwise have declared
                      fields the user can never reach. Renders nothing when a plugin
                      declares none, which is most of them. */}
                  <PluginSettingsForm pluginId={plugin.manifest.id} />
                </div>
              );
            })
          ))}

        {/* Updates tab */}
        {activeTab === "updates" &&
          (updatesCount === 0 ? (
            <div style={STYLES.centeredMessage}>All plugins are up to date</div>
          ) : (
            Object.entries(updateAvailable).map(([id, version]) => {
              const plugin = installedPlugins[id];
              if (!plugin) return null;
              const entry = registryIndex?.plugins.find((p) => p.id === id);
              if (!entry) return null;
              const updateCardStatus: PluginStatus = getPluginStatus(
                id,
                installing,
                plugin,
              );
              return (
                <PluginCard
                  entry={entry}
                  error={pluginErrors[id]}
                  key={id}
                  onInstall={() => {}}
                  onSelect={() => setSelectedEntry(entry)}
                  onUninstall={() => handleUninstall(id)}
                  onUpdate={() => handleUpdate(entry)}
                  status={updateCardStatus}
                  updateAvailable={version}
                />
              );
            })
          ))}
      </div>

      <PluginDeveloperSection />
    </div>
  );
}

function getPluginStatus(
  id: string,
  installing: Record<string, boolean>,
  plugin: undefined | { enabled: boolean },
): PluginStatus {
  if (installing[id]) return "installing";
  if (!plugin) return "not-installed";
  return plugin.enabled ? "enabled" : "disabled";
}
