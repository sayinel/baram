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
    backgroundColor: "var(--color-accent-solid)",
    color: "var(--color-accent-on-solid)",
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
  /**
   * The error TEXT, not just the badge. This tab used to show only an "Error" chip, and it is
   * the one surface where a plugin with no registry entry appears at all — Browse, Updates and
   * the detail view every one of them iterate the REGISTRY. So for a plugin whose entry has
   * been withdrawn, this was the only place the user could see it and the only place that
   * explained nothing.
   */
  installedPluginErrorText: {
    margin: "6px 0 0",
    padding: "6px 10px",
    borderRadius: "6px",
    backgroundColor: "var(--color-status-error-bg)",
    border: "1px solid var(--color-status-error-border)",
    color: "var(--color-status-danger)",
    fontSize: "12px",
    lineHeight: 1.5,
    // A load failure can carry a checksum or a path — unbroken tokens that would
    // otherwise push the row wider than the panel.
    overflowWrap: "anywhere",
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
    backgroundColor: "var(--color-status-warning)",
    color: "var(--color-status-warning-on-solid)",
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

import type {
  InstalledPlugin,
  PluginConsent,
  PluginStatus,
  RegistryEntry,
  RegistryIndex,
} from "../../plugins/types";

import { useShallow } from "zustand/shallow";

import { useTranslation } from "../../i18n/useTranslation";
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
import { revocationFor, revocationReason } from "../../plugins/revocation";
import { revocationsAreStale } from "../../plugins/revocation-client";
import { usePluginStore } from "../../stores/system/plugin";
import { logger } from "../../utils/logger";
import { legacyEntryMessage } from "./legacy-entry-message";
import { PluginCard } from "./PluginCard";
import { PluginConsentDialog } from "./PluginConsentDialog";
import { PluginDetail } from "./PluginDetail";
import { PluginDeveloperSection } from "./PluginDeveloperSection";
import { PluginSettingsForm } from "./PluginSettingsForm";

type MarketplaceTab = "browse" | "installed" | "updates";

/** What the consent dialog is currently asking about, if anything. */
interface PendingConsent {
  consent: PluginConsent;
  /** Install vs update — the caller's knowledge, not derived from the reason (M2). */
  intent: "install" | "update";
  name: string;
  prior?: PluginConsent;
}

export function PluginMarketplace() {
  const { t } = useTranslation();
  const {
    installedPlugins,
    pluginErrors,
    updateAvailable,
    installing,
    addPlugin,
    removePlugin,
    revocations,
    revocationsFetchedAt,
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
      revocations: s.revocations,
      revocationsFetchedAt: s.revocationsFetchedAt,
      setEnabled: s.setEnabled,
      setError: s.setError,
      setInstalling: s.setInstalling,
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

  // §260 Phase 5 code review (L2) — a dialog that disappears with the component must
  // resolve as a REFUSAL. Closing Settings or switching panel mid-prompt unmounts this,
  // and the awaiting `handleInstall` would otherwise hang forever: nothing visibly
  // stuck, but the user's click silently did nothing.
  useEffect(
    () => () => {
      consentResolver.current?.(null);
      consentResolver.current = null;
    },
    [],
  );

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
   * §260 Phase 5 — consent, then download, then VERIFY the download against what was
   * consented to.
   *
   * Consent is collected against the registry entry, which is a claim the registry
   * makes. The manifest inside the ZIP is the truth. Checking that they agree is what
   * makes the claim worth consenting to at all: otherwise a registry (or a swapped
   * download URL that still matches its checksum entry) could advertise "sandboxed" and
   * ship "trusted", and the user would have approved the wrong thing.
   *
   * Every check runs BEFORE `addPlugin`. That also closes a gap this flow has carried
   * since §69: the record used to be persisted first and validated only inside
   * `loadPlugin`, whose rejection merely set an error string — so an invalid manifest
   * stayed in the store, and a plugin declaring `tiptapExtensions` skipped `loadPlugin`
   * entirely and was never validated at all.
   *
   * `preApproved` is for the update path, which has already asked.
   */
  const handleInstall = useCallback(
    async (entry: RegistryEntry, preApproved?: PluginConsent) => {
      if (!entry.trust) {
        setError(entry.id, legacyEntryMessage(entry));
        return;
      }
      // §69 — installing is refused for ANY severity, where loading is refused only
      // for `malicious`. The asymmetry is deliberate: a revocation always means "do not
      // newly acquire this", while only `malicious` is worth taking a working plugin
      // away from someone who already has it. Newly installing a version already known
      // to be vulnerable, or withdrawn, has no upside to weigh against.
      const blocked = revocationFor(entry.id, entry.version, revocations);
      if (blocked !== null) {
        setError(
          entry.id,
          `${t("plugin.revoked.blockedInstall")} ${revocationReason(blocked, t)}`,
        );
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
          intent: "install",
          name: entry.name,
        }));
      if (!consent) return;

      setInstalling(entry.id, true);
      // §260 Phase 5 code review (L3) — ONE rollback site, and plain `throw` statements.
      //
      // The checks below used to call an `await reject(...)` helper that rolled back and
      // threw. Correct at runtime, but not compiler-checkable: `await` of a
      // `Promise<never>` gives TypeScript no control-flow narrowing, so a fourth check
      // appended after one would compile and run. ‼️The reviewer's suggested
      // `return reject(...)` narrows but BREAKS the error path — a `return` inside `try`
      // hands control out of the block, so `catch` never sees the rejection and no error
      // badge appears (four tests caught this). A `throw` statement does both.
      //
      // Non-null only while extracted files exist that nothing has vouched for yet.
      let rolledBackId: null | string = null;
      try {
        // The third argument is the guard, not a formality: Rust refuses the archive before
        // moving it into place if its manifest declares a different id, so a hostile
        // listing cannot destroy an unrelated installed plugin (re-review R5). The
        // frontend check below is then defence in depth.
        const result = await pluginInstall(
          entry.downloadUrl,
          entry.checksum,
          entry.id,
        );
        // Where the files actually landed, whatever the registry called the entry, so
        // the one rollback site in `catch` can remove them.
        rolledBackId = result.manifest.id;

        const validation = validateManifest(result.manifest);
        if (!validation.valid) {
          throw new Error(
            t("plugin.error.manifestInvalid", {
              detail: validation.errors
                .map((e) => `${e.field}: ${e.message}`)
                .join("; "),
            }),
          );
        }
        if (result.manifest.id !== entry.id) {
          throw new Error(
            t("plugin.error.idMismatch", {
              expected: entry.id,
              got: result.manifest.id,
            }),
          );
        }
        const gaps = consentGaps(consent, {
          capabilities: result.manifest.capabilities,
          trust: result.manifest.trust,
        });
        if (gaps.length > 0) {
          throw new Error(
            t("plugin.error.consentGap", { detail: gaps.join("; ") }),
          );
        }

        // Past every check — nothing below may delete the installed files.
        rolledBackId = null;

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
        if (rolledBackId !== null) {
          await pluginUninstall(rolledBackId).catch((e: unknown) =>
            logger.error("[Marketplace] rollback failed:", e),
          );
        }
        setError(entry.id, String(err));
      } finally {
        setInstalling(entry.id, false);
      }
    },
    [addPlugin, askConsent, revocations, setError, setInstalling, t],
  );

  /**
   * Returns whether the plugin is actually gone (§260 Phase 5 code review).
   *
   * It swallows its own failure by design — a user clicking Uninstall wants an error
   * badge, not a thrown promise — but `handleUpdate` needs the outcome: on a failure
   * `removePlugin` never runs, so the OLD record survives, and a presence check after the
   * failed reinstall then sees it and concludes the update worked.
   */
  const handleUninstall = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        await pluginLoader.unloadPlugin(id);
        await pluginUninstall(id);
        removePlugin(id);
        return true;
      } catch (err) {
        setError(id, String(err));
        return false;
      }
    },
    [removePlugin, setError],
  );

  const handleUpdate = useCallback(
    async (candidate: RegistryEntry) => {
      // §260 Phase 5 code review (H2) — resolve the LISTING; never update from the entry
      // handed in. The Installed tab synthesises one out of the installed manifest with
      // `downloadUrl: ""`, which broke this two ways: `handleUninstall` deletes the files
      // and the record, then `pluginInstall("")` can never succeed — so an update from
      // that tab destroyed the plugin every time. And `claimed` was built from the
      // manifest ALREADY INSTALLED, so `consentRequired` returned null unconditionally and
      // the escalation check this phase exists to add was structurally dead there.
      //
      // Fixed here rather than at the call site so a future tab cannot reintroduce it.
      const entry = registryIndex?.plugins.find((p) => p.id === candidate.id);
      if (!entry) {
        setError(candidate.id, t("plugin.error.notInRegistry"));
        return;
      }
      if (!entry.trust) {
        setError(entry.id, legacyEntryMessage(entry));
        return;
      }
      // §69 — checked HERE, before the uninstall below, not only in `handleInstall`.
      // An update is uninstall-then-install, so a target caught only at the install
      // step would leave the user with their working plugin already deleted.
      const blockedUpdate = revocationFor(entry.id, entry.version, revocations);
      if (blockedUpdate !== null) {
        setError(
          entry.id,
          `${t("plugin.revoked.blockedInstall")} ${revocationReason(blockedUpdate, t)}`,
        );
        return;
      }
      // §260 Phase 5 — read the recorded consent BEFORE uninstalling: `handleUninstall`
      // calls `removePlugin`, which deletes the very record this compares against.
      // Without that ordering an update would always look like a first install.
      const prior = installedPlugins[entry.id]?.consent;
      const claimed: PluginConsent = {
        capabilities: [...entry.capabilities].sort(),
        trust: entry.trust,
      };
      const reason = consentRequired(prior, claimed);
      // When the recorded consent already covers this version, record the CLAIMED shape
      // rather than carrying the old one forward — an update that drops a capability
      // must narrow the record too, or the grant outlives the version that needed it.
      const consent =
        reason === null
          ? claimed
          : await askConsent({
              consent: claimed,
              intent: "update",
              name: entry.name,
              prior,
            });
      if (!consent) return;

      // ‼️ An update is uninstall-then-install, so a REJECTED download leaves the user
      // with nothing — the working version is already gone by the time the new one fails
      // its checks. Phase 5 makes that outcome more reachable (there are three new ways
      // to fail), so say it plainly instead of leaving a bare error and an empty slot.
      // The real fix is staging the download before removing anything, which needs a
      // Rust-side temp install; deliberately out of scope here.
      // If the removal itself failed the old version is still installed and still
      // running, so reinstalling on top of it would be the wrong repair — stop with the
      // error `handleUninstall` already recorded.
      if (!(await handleUninstall(entry.id))) return;

      await handleInstall(entry, consent);
      if (usePluginStore.getState().installedPlugins[entry.id] === undefined) {
        const why = usePluginStore.getState().pluginErrors[entry.id] ?? "";
        setError(
          entry.id,
          t("plugin.error.updateLostPlugin", { name: entry.name, why }),
        );
        return;
      }
      clearUpdateAvailable(entry.id);
    },
    [
      askConsent,
      clearUpdateAvailable,
      handleInstall,
      handleUninstall,
      installedPlugins,
      registryIndex,
      revocations,
      setError,
      t,
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
          revocation={revocationFor(
            selectedEntry.id,
            selectedEntry.version,
            revocations,
          )}
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
                  revoked={
                    revocationFor(entry.id, entry.version, revocations) !== null
                  }
                  status={cardStatus}
                  updateAvailable={updateAvailable[entry.id]}
                />
              );
            })
          ))}

        {/* Installed tab */}
        {activeTab === "installed" &&
          (installedList.length === 0 ? (
            <div style={STYLES.centeredMessage}>
              {t("plugin.marketplace.emptyInstalled")}
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
                          <span style={STYLES.installedPluginError}>
                            {t("plugin.marketplace.error")}
                          </span>
                        )}
                      </div>
                      <p style={STYLES.installedPluginDescription}>
                        {plugin.manifest.description}
                      </p>
                      {pluginErrors[plugin.manifest.id] && (
                        <p style={STYLES.installedPluginErrorText}>
                          ⚠ {pluginErrors[plugin.manifest.id]}
                        </p>
                      )}
                    </div>
                    <div style={STYLES.installedRowActions}>
                      {updateAvailable[plugin.manifest.id] && (
                        <button
                          onClick={() => handleUpdate(entry)}
                          style={STYLES.updateButton}
                        >
                          {t("plugin.action.update")}
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
                          {plugin.enabled
                            ? t("plugin.action.on")
                            : t("plugin.action.off")}
                        </span>
                      </label>
                      <button
                        onClick={() => handleUninstall(plugin.manifest.id)}
                        style={STYLES.removeButton}
                      >
                        {t("plugin.action.remove")}
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
            <div style={STYLES.centeredMessage}>
              {t("plugin.marketplace.emptyUpdates")}
            </div>
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
                  revoked={
                    revocationFor(entry.id, entry.version, revocations) !== null
                  }
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
