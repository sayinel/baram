// §69 Plugin Marketplace — Main sidebar panel with Browse / Installed / Updates tabs
import { useState, useEffect, useCallback } from "react";
import { usePluginStore } from "../../stores/plugin-store";
import { pluginInstall, pluginUninstall } from "../../ipc/plugin-invoke";
import { readFile } from "../../ipc/invoke";
import { fetchRegistryIndex, searchRegistry } from "../../plugins/registry-client";
import { pluginLoader } from "../../plugins/plugin-loader";
import { PluginCard } from "./PluginCard";
import { PluginDetail } from "./PluginDetail";
import type { RegistryEntry, RegistryIndex, InstalledPlugin, PluginCapability } from "../../plugins/types";
import { CAPABILITY_DESCRIPTIONS } from "../../plugins/types";

type MarketplaceTab = "browse" | "installed" | "updates";

export function PluginMarketplace() {
  const {
    installedPlugins, pluginErrors, updateAvailable, installing,
    addPlugin, removePlugin, setEnabled, setError, setInstalling, clearUpdateAvailable,
  } = usePluginStore();

  const [activeTab, setActiveTab] = useState<MarketplaceTab>("browse");
  const [registryIndex, setRegistryIndex] = useState<RegistryIndex | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntry, setSelectedEntry] = useState<RegistryEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setFetchError] = useState<string | null>(null);
  const [readme, setReadme] = useState<string | null>(null);

  // Load README for selected installed plugin
  useEffect(() => {
    if (!selectedEntry) { setReadme(null); return; }
    const plugin = installedPlugins[selectedEntry.id];
    if (!plugin) { setReadme(null); return; }
    let cancelled = false;
    readFile(`${plugin.installPath}/README.md`)
      .then((content) => { if (!cancelled) setReadme(content); })
      .catch(() => { if (!cancelled) setReadme(null); });
    return () => { cancelled = true; };
  }, [selectedEntry, installedPlugins]);

  // Fetch registry on mount
  useEffect(() => {
    setLoading(true);
    fetchRegistryIndex()
      .then((index) => { setRegistryIndex(index); setFetchError(null); })
      .catch((err) => setFetchError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  const filteredPlugins = registryIndex
    ? searchRegistry(registryIndex, searchQuery)
    : [];

  const installedList = Object.values(installedPlugins);
  const updatesCount = Object.keys(updateAvailable).length;

  // --- Install handler with capability review ---
  const handleInstall = useCallback(async (entry: RegistryEntry) => {
    // Show capability review
    if (entry.capabilities.length > 0) {
      const capDescriptions = entry.capabilities
        .map((c) => `\u2022 ${CAPABILITY_DESCRIPTIONS[c as PluginCapability] ?? c}`)
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
  }, [addPlugin, setError, setInstalling]);

  const handleUninstall = useCallback(async (id: string) => {
    try {
      await pluginLoader.unloadPlugin(id);
      await pluginUninstall(id);
      removePlugin(id);
    } catch (err) {
      setError(id, String(err));
    }
  }, [removePlugin, setError]);

  const handleUpdate = useCallback(async (entry: RegistryEntry) => {
    // Check for new capabilities
    const currentPlugin = installedPlugins[entry.id];
    if (currentPlugin) {
      const currentCaps = new Set(currentPlugin.manifest.capabilities);
      const newCaps = entry.capabilities.filter((c) => !currentCaps.has(c as PluginCapability));
      if (newCaps.length > 0) {
        const capDescriptions = newCaps
          .map((c) => `\u2022 ${CAPABILITY_DESCRIPTIONS[c as PluginCapability] ?? c}`)
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
  }, [installedPlugins, handleInstall, handleUninstall, clearUpdateAvailable]);

  const handleToggleEnabled = useCallback((id: string) => {
    const plugin = installedPlugins[id];
    if (!plugin) return;
    const newEnabled = !plugin.enabled;
    setEnabled(id, newEnabled);
    if (newEnabled) {
      pluginLoader.loadPlugin(plugin.installPath, plugin.manifest).catch((err) => {
        setError(id, String(err));
        setEnabled(id, false);
      });
    } else {
      pluginLoader.unloadPlugin(id);
    }
  }, [installedPlugins, setEnabled, setError]);

  // If detail view is showing
  if (selectedEntry) {
    const plugin = installedPlugins[selectedEntry.id];
    return (
      <PluginDetail
        entry={selectedEntry}
        installed={!!plugin}
        installing={!!installing[selectedEntry.id]}
        enabled={plugin?.enabled}
        updateAvailable={updateAvailable[selectedEntry.id]}
        error={pluginErrors[selectedEntry.id]}
        readme={readme}
        onInstall={() => handleInstall(selectedEntry)}
        onUninstall={() => handleUninstall(selectedEntry.id)}
        onUpdate={() => handleUpdate(selectedEntry)}
        onToggleEnabled={() => handleToggleEnabled(selectedEntry.id)}
        onBack={() => setSelectedEntry(null)}
      />
    );
  }

  return (
    <div className="plugin-marketplace" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px 0" }}>
        <h2 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 600, color: "var(--color-text, #111)" }}>Plugins</h2>

        {/* Tabs */}
        <div style={{ display: "flex", gap: "0", borderBottom: "1px solid var(--color-border, #e5e7eb)", marginBottom: "8px" }}>
          {(["browse", "installed", "updates"] as MarketplaceTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "6px 12px", fontSize: "13px", fontWeight: activeTab === tab ? 600 : 400,
                color: activeTab === tab ? "var(--color-accent, #3b82f6)" : "var(--color-text-muted, #6b7280)",
                backgroundColor: "transparent", border: "none", cursor: "pointer",
                borderBottom: activeTab === tab ? "2px solid var(--color-accent, #3b82f6)" : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              {tab === "browse" ? "Browse" : tab === "installed" ? `Installed (${installedList.length})` : `Updates (${updatesCount})`}
            </button>
          ))}
        </div>

        {/* Search (browse tab only) */}
        {activeTab === "browse" && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search plugins..."
            style={{
              width: "100%", padding: "8px 12px", borderRadius: "6px", fontSize: "13px",
              border: "1px solid var(--color-border, #e5e7eb)", backgroundColor: "var(--color-bg, #fff)",
              color: "var(--color-text, #111)", outline: "none", boxSizing: "border-box",
              marginBottom: "8px",
            }}
          />
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Error state */}
        {error && activeTab === "browse" && (
          <div style={{ padding: "16px", textAlign: "center", color: "var(--color-text-muted, #6b7280)", fontSize: "13px" }}>
            <p>Failed to load registry</p>
            <p style={{ fontSize: "12px", opacity: 0.7 }}>{error}</p>
            <button
              onClick={() => {
                setLoading(true);
                fetchRegistryIndex(true)
                  .then(setRegistryIndex)
                  .catch((e) => setFetchError(String(e)))
                  .finally(() => setLoading(false));
              }}
              style={{ marginTop: "8px", padding: "6px 12px", borderRadius: "6px", fontSize: "12px", cursor: "pointer", backgroundColor: "var(--color-accent, #3b82f6)", color: "#fff", border: "none" }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && activeTab === "browse" && (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-muted, #6b7280)", fontSize: "13px" }}>
            Loading plugins...
          </div>
        )}

        {/* Browse tab */}
        {activeTab === "browse" && !loading && !error && (
          filteredPlugins.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-muted, #9ca3af)", fontSize: "13px" }}>
              {searchQuery ? "No plugins found" : "No plugins available"}
            </div>
          ) : (
            filteredPlugins.map((entry) => (
              <PluginCard
                key={entry.id}
                entry={entry}
                installed={!!installedPlugins[entry.id]}
                installing={!!installing[entry.id]}
                updateAvailable={updateAvailable[entry.id]}
                onInstall={() => handleInstall(entry)}
                onUninstall={() => handleUninstall(entry.id)}
                onUpdate={() => handleUpdate(entry)}
                onSelect={() => setSelectedEntry(entry)}
              />
            ))
          )
        )}

        {/* Installed tab */}
        {activeTab === "installed" && (
          installedList.length === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-muted, #9ca3af)", fontSize: "13px" }}>
              No plugins installed
            </div>
          ) : (
            installedList.map((plugin) => {
              const entry: RegistryEntry = {
                ...plugin.manifest,
                downloadUrl: "",
                checksum: plugin.checksum,
                downloads: undefined,
              };
              return (
                <div key={plugin.manifest.id} style={{ borderBottom: "1px solid var(--color-border, #e5e7eb)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--color-text, #111)" }}>{plugin.manifest.name}</span>
                        <span style={{ fontSize: "12px", color: "var(--color-text-muted, #6b7280)" }}>v{plugin.manifest.version}</span>
                        {pluginErrors[plugin.manifest.id] && (
                          <span style={{ fontSize: "11px", color: "var(--color-error, #dc2626)", fontWeight: 500 }}>Error</span>
                        )}
                      </div>
                      <p style={{ margin: "2px 0 0", fontSize: "12px", color: "var(--color-text-secondary, #4b5563)" }}>
                        {plugin.manifest.description}
                      </p>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                      {updateAvailable[plugin.manifest.id] && (
                        <button
                          onClick={() => handleUpdate(entry)}
                          style={{
                            padding: "4px 12px", borderRadius: "4px", fontSize: "12px",
                            backgroundColor: "#f59e0b", color: "#fff", border: "none", cursor: "pointer",
                          }}
                        >
                          Update
                        </button>
                      )}
                      <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={plugin.enabled}
                          onChange={() => handleToggleEnabled(plugin.manifest.id)}
                          style={{ marginRight: "4px" }}
                        />
                        <span style={{ fontSize: "12px", color: "var(--color-text-muted, #6b7280)" }}>
                          {plugin.enabled ? "On" : "Off"}
                        </span>
                      </label>
                      <button
                        onClick={() => handleUninstall(plugin.manifest.id)}
                        style={{
                          padding: "4px 8px", borderRadius: "4px", fontSize: "12px",
                          backgroundColor: "transparent", color: "var(--color-error, #dc2626)",
                          border: "1px solid var(--color-error, #dc2626)", cursor: "pointer",
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )
        )}

        {/* Updates tab */}
        {activeTab === "updates" && (
          updatesCount === 0 ? (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--color-text-muted, #9ca3af)", fontSize: "13px" }}>
              All plugins are up to date
            </div>
          ) : (
            Object.entries(updateAvailable).map(([id, version]) => {
              const plugin = installedPlugins[id];
              if (!plugin) return null;
              const entry = registryIndex?.plugins.find((p) => p.id === id);
              if (!entry) return null;
              return (
                <PluginCard
                  key={id}
                  entry={entry}
                  installed
                  installing={!!installing[id]}
                  updateAvailable={version}
                  onInstall={() => {}}
                  onUninstall={() => handleUninstall(id)}
                  onUpdate={() => handleUpdate(entry)}
                  onSelect={() => setSelectedEntry(entry)}
                />
              );
            })
          )
        )}
      </div>
    </div>
  );
}
