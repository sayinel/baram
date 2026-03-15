// §69 Plugin Marketplace — Main sidebar panel with Browse / Installed / Updates tabs
import React, { useCallback, useEffect, useState } from "react";

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
    color: "var(--color-text, #111)",
  } as React.CSSProperties,
  tabBar: {
    display: "flex",
    gap: "0",
    borderBottom: "1px solid var(--color-border, #e5e7eb)",
    marginBottom: "8px",
  } as React.CSSProperties,
  searchInput: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "6px",
    fontSize: "13px",
    border: "1px solid var(--color-border, #e5e7eb)",
    backgroundColor: "var(--color-bg, #fff)",
    color: "var(--color-text, #111)",
    outline: "none",
    boxSizing: "border-box",
    marginBottom: "8px",
  } as React.CSSProperties,
  content: { flex: 1, overflowY: "auto" } as React.CSSProperties,
  centeredMessage: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--color-text-muted, #9ca3af)",
    fontSize: "13px",
  } as React.CSSProperties,
  errorMessage: {
    padding: "16px",
    textAlign: "center",
    color: "var(--color-text-muted, #6b7280)",
    fontSize: "13px",
  } as React.CSSProperties,
  errorSubtext: { fontSize: "12px", opacity: 0.7 } as React.CSSProperties,
  retryButton: {
    marginTop: "8px",
    padding: "6px 12px",
    borderRadius: "6px",
    fontSize: "12px",
    cursor: "pointer",
    backgroundColor: "var(--color-accent, #3b82f6)",
    color: "#fff",
    border: "none",
  } as React.CSSProperties,
  loadingMessage: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--color-text-muted, #6b7280)",
    fontSize: "13px",
  } as React.CSSProperties,
  installedRow: {
    borderBottom: "1px solid var(--color-border, #e5e7eb)",
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
    color: "var(--color-text, #111)",
  } as React.CSSProperties,
  installedPluginVersion: {
    fontSize: "12px",
    color: "var(--color-text-muted, #6b7280)",
  } as React.CSSProperties,
  installedPluginError: {
    fontSize: "11px",
    color: "var(--color-error, #dc2626)",
    fontWeight: 500,
  } as React.CSSProperties,
  installedPluginDescription: {
    margin: "2px 0 0",
    fontSize: "12px",
    color: "var(--color-text-secondary, #4b5563)",
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
    color: "var(--color-text-muted, #6b7280)",
  } as React.CSSProperties,
  removeButton: {
    padding: "4px 8px",
    borderRadius: "4px",
    fontSize: "12px",
    backgroundColor: "transparent",
    color: "var(--color-error, #dc2626)",
    border: "1px solid var(--color-error, #dc2626)",
    cursor: "pointer",
  } as React.CSSProperties,
  tabButtonActive: {
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--color-accent, #3b82f6)",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    borderBottom: "2px solid var(--color-accent, #3b82f6)",
    marginBottom: "-1px",
  } as React.CSSProperties,
  tabButtonInactive: {
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: 400,
    color: "var(--color-text-muted, #6b7280)",
    backgroundColor: "transparent",
    border: "none",
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    marginBottom: "-1px",
  } as React.CSSProperties,
};

import type {
  InstalledPlugin,
  PluginCapability,
  PluginStatus,
  RegistryEntry,
  RegistryIndex,
} from "../../plugins/types";

import { readFile } from "../../ipc/invoke";
import { pluginInstall, pluginUninstall } from "../../ipc/plugin-invoke";
import { pluginLoader } from "../../plugins/plugin-loader";
import {
  fetchRegistryIndex,
  searchRegistry,
} from "../../plugins/registry-client";
import { CAPABILITY_DESCRIPTIONS } from "../../plugins/types";
import { usePluginStore } from "../../stores/system/plugin";
import { PluginCard } from "./PluginCard";
import { PluginDetail } from "./PluginDetail";

type MarketplaceTab = "browse" | "installed" | "updates";

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
  } = usePluginStore();

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

  // --- Install handler with capability review ---
  const handleInstall = useCallback(
    async (entry: RegistryEntry) => {
      // Show capability review
      if (entry.capabilities.length > 0) {
        const capDescriptions = entry.capabilities
          .map(
            (c) =>
              `\u2022 ${CAPABILITY_DESCRIPTIONS[c as PluginCapability] ?? c}`,
          )
          .join("\n");
        const confirmed = window.confirm(
          `"${entry.name}" requests the following permissions:\n\n${capDescriptions}\n\nDo you want to install this plugin?`,
        );
        if (!confirmed) return;
      }

      setInstalling(entry.id, true);
      try {
        const result = await pluginInstall(entry.downloadUrl, entry.checksum);
        const plugin: InstalledPlugin = {
          manifest: result.manifest,
          installPath: result.install_path,
          enabled: true,
          installedAt: Date.now(),
          updatedAt: Date.now(),
          checksum: result.checksum,
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
    [addPlugin, setError, setInstalling],
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
      // Check for new capabilities
      const currentPlugin = installedPlugins[entry.id];
      if (currentPlugin) {
        const currentCaps = new Set(currentPlugin.manifest.capabilities);
        const newCaps = entry.capabilities.filter(
          (c) => !currentCaps.has(c as PluginCapability),
        );
        if (newCaps.length > 0) {
          const capDescriptions = newCaps
            .map(
              (c) =>
                `\u2022 ${CAPABILITY_DESCRIPTIONS[c as PluginCapability] ?? c}`,
            )
            .join("\n");
          const confirmed = window.confirm(
            `"${entry.name}" update requests new permissions:\n\n${capDescriptions}\n\nDo you want to update?`,
          );
          if (!confirmed) return;
        }
      }

      await handleUninstall(entry.id);
      await handleInstall(entry);
      clearUpdateAvailable(entry.id);
    },
    [installedPlugins, handleInstall, handleUninstall, clearUpdateAvailable],
  );

  const handleToggleEnabled = useCallback(
    (id: string) => {
      const plugin = installedPlugins[id];
      if (!plugin) return;
      const newEnabled = !plugin.enabled;
      setEnabled(id, newEnabled);
      if (newEnabled) {
        pluginLoader
          .loadPlugin(plugin.installPath, plugin.manifest)
          .catch((err) => {
            setError(id, String(err));
            setEnabled(id, false);
          });
      } else {
        pluginLoader.unloadPlugin(id);
      }
    },
    [installedPlugins, setEnabled, setError],
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
    );
  }

  return (
    <div className="plugin-marketplace" style={STYLES.container}>
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
              onClick={() => {
                setLoading(true);
                fetchRegistryIndex(true)
                  .then(setRegistryIndex)
                  .catch((e) => setFetchError(String(e)))
                  .finally(() => setLoading(false));
              }}
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
