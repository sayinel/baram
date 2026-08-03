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

import { getVersion } from "@tauri-apps/api/app";

import type { Translate } from "../../i18n/useTranslation";
import type { RustCommittedPluginInfo } from "../../ipc/plugin-invoke";
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
import {
  pluginInstallCommit,
  pluginInstallDiscard,
  pluginInstallStage,
  pluginUninstall,
} from "../../ipc/plugin-invoke";
import { parseBaramFloor, unmetBaramFloor } from "../../plugins/engines";
import { validateManifest } from "../../plugins/manifest";
import { consentGaps, consentRequired } from "../../plugins/plugin-consent";
import { pluginLoader } from "../../plugins/plugin-loader";
import {
  checkForUpdates,
  fetchRegistryIndex,
  searchRegistry,
} from "../../plugins/registry-client";
import { revocationFor, revocationReason } from "../../plugins/revocation";
import {
  refreshRevocations,
  revocationsAreStale,
} from "../../plugins/revocation-client";
import { usePluginStore } from "../../stores/system/plugin";
import { logger } from "../../utils/logger";
import { legacyEntryMessage } from "./legacy-entry-message";
import { PluginCard } from "./PluginCard";
import { PluginConsentDialog } from "./PluginConsentDialog";
import { PluginDetail } from "./PluginDetail";
import { PluginDeveloperSection } from "./PluginDeveloperSection";
import { PluginRevokedNotice } from "./PluginRevokedNotice";
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
  /** Plugin ids with an install in flight — see the guard at the top of `handleInstall`. */
  const inFlight = useRef<Set<string>>(new Set());

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
   * ‼️ #261 — AND EVERY ONE OF THEM RUNS BEFORE ANYTHING INSTALLED IS TOUCHED.
   *
   * `pluginInstallStage` downloads and extracts to a staging directory; only
   * `pluginInstallCommit` swaps. So a refusal below is a `pluginInstallDiscard` of files
   * nobody has yet, rather than what it used to be — the previously installed version
   * already deleted and unrecoverable. This is what lets `handleUpdate` stop composing
   * uninstall with install.
   *
   * Returns whether the plugin ended up installed, which `handleUpdate` needs and no
   * other caller uses.
   *
   * `preApproved` is for the update path, which has already asked.
   */
  const handleInstall = useCallback(
    async (
      entry: RegistryEntry,
      preApproved?: PluginConsent,
    ): Promise<boolean> => {
      // ‼️ BEFORE THE FIRST AWAIT (#261 security review, area 3). `setInstalling` is a
      // store write that sits below two `getVersion` IPCs and, on the common update path,
      // below no dialog at all — so nothing stopped a double-click from running two installs
      // of the same plugin concurrently. Two commits interleave badly: the first renames the
      // target aside, the second sees no target and takes the fast path, and the first's
      // rename AND its restore then both fail `ENOTEMPTY` — reporting "your previous version
      // is stranded at …" for a plugin that is perfectly fine, and leaking an absolute home
      // path while it does. A ref rather than state, because this has to be true immediately
      // rather than after a render.
      if (inFlight.current.has(entry.id)) return false;
      inFlight.current.add(entry.id);
      try {
        if (!entry.trust) {
          setError(entry.id, legacyEntryMessage(entry));
          return false;
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
          return false;
        }
        // §69 — the floor the manifest declares, compared to the running app at last.
        // Refusing here rather than letting activation throw keeps a pointless download off
        // the wire; the authoritative check is the one below, against what was downloaded.
        const tooOld = await floorRefusal(entry.engines, t);
        if (tooOld !== null) {
          setError(entry.id, tooOld);
          return false;
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
        if (!consent) return false;

        setInstalling(entry.id, true);
        try {
          // §260 Phase 5 code review (L3) — ONE cleanup site, and plain `throw` statements.
          //
          // The checks below used to call an `await reject(...)` helper that rolled back and
          // threw. Correct at runtime, but not compiler-checkable: `await` of a
          // `Promise<never>` gives TypeScript no control-flow narrowing, so a fourth check
          // appended after one would compile and run. ‼The reviewer's suggested
          // `return reject(...)` narrows but BREAKS the error path — a `return` inside `try`
          // hands control out of the block, so `catch` never sees the rejection and no error
          // badge appears (four tests caught this). A `throw` statement does both.
          //
          // Non-null only while a staged copy exists that nothing has committed yet.
          let pendingStage: null | string = null;
          // The record of the version this is replacing, once its runtime has been torn
          // down — non-null only while a restart is owed.
          let unloaded: InstalledPlugin | null = null;
          let checksum: string;
          let committed: RustCommittedPluginInfo;
          try {
            // Two of these arguments are guards, not formalities. `entry.id` makes Rust
            // refuse an archive whose manifest declares a different id, so a hostile listing
            // cannot aim this download at an unrelated installed plugin's directory
            // (re-review R5); the frontend check below is then defence in depth.
            //
            // `registryUrl` makes Rust refuse an archive that is not served under the index
            // that named it. Read from the store here rather than closed over, so it is the
            // URL in force at install time — and it is the same string `registry-client.ts`
            // fetched the listing with.
            const staged = await pluginInstallStage(
              entry.downloadUrl,
              usePluginStore.getState().registryUrl,
              entry.checksum,
              entry.id,
            );
            pendingStage = staged.stage_id;
            checksum = staged.checksum;
            const manifest = staged.manifest;

            const validation = validateManifest(manifest);
            if (!validation.valid) {
              throw new Error(
                t("plugin.error.manifestInvalid", {
                  detail: validation.errors
                    .map((e) => `${e.field}: ${e.message}`)
                    .join("; "),
                }),
              );
            }
            if (manifest.id !== entry.id) {
              throw new Error(
                t("plugin.error.idMismatch", {
                  expected: entry.id,
                  got: manifest.id,
                }),
              );
            }
            const gaps = consentGaps(consent, {
              capabilities: manifest.capabilities,
              trust: manifest.trust,
            });
            if (gaps.length > 0) {
              throw new Error(
                t("plugin.error.consentGap", { detail: gaps.join("; ") }),
              );
            }
            // §69 code review — the floor, re-checked against the DOWNLOADED manifest.
            //
            // The gate above judged `entry.engines`, and this function's own doctrine is
            // that the entry is a claim while the archive is the truth: id, tier and
            // capabilities are re-verified here for exactly that reason, and `engines` was
            // the one checked field still taking the registry's word. A stale index, or any
            // registry that under-declares a floor, would otherwise install a plugin this
            // app cannot run — the outcome the gate exists to prevent.
            const downloadTooOld = await floorRefusal(manifest.engines, t);
            if (downloadTooOld !== null) {
              throw new Error(downloadTooOld);
            }
            // ‼️ AND THE CASE NEITHER FLOOR CHECK CAN EVALUATE (#261 code review, HIGH-1).
            //
            // `parseBaramFloor` understands `>=X.Y.Z` and nothing else, deliberately: it
            // shares its grammar with the publish gate so the two cannot disagree about the
            // same manifest. So an absent `engines`, `"*"`, `^0.6.0` and `~0.5` all mean "no
            // opinion" to BOTH checks — the one against the listing and the one against the
            // archive. Staging did not change that, and an earlier draft of this comment
            // claimed otherwise.
            //
            // On an INSTALL that is right: no opinion means proceed, and a plugin that then
            // fails to activate costs the user nothing they had. On an UPDATE it is not,
            // because the commit below is a one-way door — the previous version is replaced
            // atomically and its backup released, so an activation failure leaves the user
            // with a dead plugin and no way back to the working one. Refusing here costs a
            // discard; the alternative costs a plugin.
            //
            // ‼️ STRICTLY NARROWER THAN THE GUARD IT REPLACES, which lived above the download
            // and could only read the listing: this refuses only when the ARCHIVE also
            // declines to say, so an entry that omits `engines` while its ZIP declares
            // `>=0.5.0` now updates where it used to be refused. Deleting it entirely is the
            // follow-up (roll the swap back when activation fails), which makes the whole
            // question moot.
            const isUpdate =
              usePluginStore.getState().installedPlugins[entry.id] !==
              undefined;
            if (
              isUpdate &&
              parseBaramFloor(entry.engines?.baram) === null &&
              parseBaramFloor(manifest.engines.baram) === null
            ) {
              throw new Error(
                t("plugin.error.updateUnverifiableFloor", { name: entry.name }),
              );
            }

            // Past every check. THESE TWO LINES are the first that touch an installed
            // plugin, and a failure in either leaves the previous version in place — Rust
            // restores it — so the staged copy is discarded below like any other failure.
            //
            // The old version's runtime is unloaded first: the module and its sandbox
            // window are about to be replaced underneath it, and `unloadPlugin` is what
            // tears down that window, its commands and its UI contributions. A no-op when
            // nothing is loaded. A teardown that FAILS aborts the update, because swapping
            // the files under a plugin that is still running is worse than not updating.
            // Read fresh rather than from the render's closure: this is the record the
            // restart below needs, and it must be the one that is true right now.
            unloaded =
              usePluginStore.getState().installedPlugins[manifest.id] ?? null;
            await pluginLoader.unloadPlugin(manifest.id);
            // The digest pins the manifest to the one every check above judged. A stage
            // sits on disk across this whole block — an app-version IPC and the entire
            // `unloadPlugin` teardown — during which a trusted-tier plugin is still running
            // in the main realm. Without it, the manifest that gets recorded, granted and
            // loaded need not be the one that was consented to (#261 security review).
            committed = await pluginInstallCommit(
              pendingStage,
              entry.id,
              staged.manifest_sha256,
            );
          } catch (err) {
            if (pendingStage !== null) {
              await pluginInstallDiscard(pendingStage).catch((e: unknown) =>
                logger.error(
                  "[Marketplace] discarding the staged install failed:",
                  e,
                ),
              );
            }
            // ‼️ PUT THE OLD RUNTIME BACK (#261 review, MEDIUM-1 / security area 2). The
            // unload above is the one step before the commit that is not undone by keeping
            // the files: if the commit then fails, Rust restores the BYTES but the plugin is
            // no longer running — its sandbox window is closed, its commands, ribbon icon
            // and statusbar item are gone — while the store still says `enabled: true`.
            // Nothing reconciles enabled-vs-loaded except `initializePlugins` at startup, so
            // the user would see an enabled plugin that had silently vanished until restart.
            if (unloaded !== null) {
              await pluginLoader
                .loadPlugin(unloaded.installPath, unloaded.manifest)
                .catch((e: unknown) =>
                  logger.error(
                    "[Marketplace] could not restart the previous version:",
                    e,
                  ),
                );
            }
            setError(entry.id, String(err));
            return false;
          }

          // ‼ PAST THE COMMIT, AND OUTSIDE THE BLOCK THAT DISCARDS. Structural rather
          // than a flag: an earlier draft cleared a `pendingStage` variable here instead,
          // which no test could falsify — nothing below throws past the `catch` — so the
          // line read as a guard while guarding nothing. Scope says it now, and the
          // compiler enforces it.
          const plugin: InstalledPlugin = {
            checksum,
            consent,
            enabled: true,
            installedAt: Date.now(),
            installPath: committed.install_path,
            manifest: committed.manifest,
            updatedAt: Date.now(),
          };
          addPlugin(plugin);
          setError(entry.id, null);

          // Load the plugin if it doesn't have tiptap extensions (those need restart)
          //
          // ‼ ACTIVATION FAILURE IS NOT ROLLED BACK (#261, the policy the issue asks be
          // stated). The files are installed and stay installed: they passed the checksum,
          // the manifest, the consent comparison and the version floor, so the fault is in
          // running the plugin, not in the copy of it on disk. Silently reverting to an
          // older version the user did not ask for would be its own surprise, and the older
          // version is gone by now in any case — the swap is atomic, not undoable later.
          // What the user gets is the plugin installed with the activation error against
          // it, and Disable or Uninstall to hand.
          //
          // Caught HERE rather than left to propagate, so this still reports success: the
          // new version is on disk and recorded, and returning false would leave the
          // "update available" badge up and invite the user to install it again.
          if (!committed.manifest.tiptapExtensions?.length) {
            try {
              await pluginLoader.loadPlugin(
                committed.install_path,
                committed.manifest,
              );
            } catch (activationError) {
              setError(entry.id, String(activationError));
            }
          }
          return true;
        } finally {
          setInstalling(entry.id, false);
        }
      } finally {
        inFlight.current.delete(entry.id);
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
      // and the record, then a download of `""` can never succeed — so an update from
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
      // §69 — checked here as well as in `handleInstall`, so a revoked target is refused
      // without a pointless download. Since #261 nothing is destroyed either way.
      const blockedUpdate = revocationFor(entry.id, entry.version, revocations);
      if (blockedUpdate !== null) {
        setError(
          entry.id,
          `${t("plugin.revoked.blockedInstall")} ${revocationReason(blockedUpdate, t)}`,
        );
        return;
      }
      // §69 — and the version floor, for the same reason and in the same place.
      // `entry` is the resolved LISTING, so this reads the TARGET's floor and not the
      // installed manifest's — pinned by the fixture in `plugin-engines-gate.test.tsx`.
      const targetTooOld = await floorRefusal(entry.engines, t);
      if (targetTooOld !== null) {
        setError(entry.id, targetTooOld);
        return;
      }
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

      // ‼️ #261 — AN UPDATE IS NOW ONE OPERATION.
      //
      // This used to be `handleUninstall(...)` followed by `handleInstall(...)`: the
      // working version was deleted first, so a download that failed, or an archive that
      // failed any of the post-download checks, left the user with nothing and an error
      // telling them to reinstall from the registry. `handleInstall` stages, validates and
      // only then swaps atomically, which makes every one of those outcomes a discard.
      //
      // Nothing here removes the old record either — `handleInstall` overwrites it on
      // success, so a failure leaves the installed version recorded exactly as it is on
      // disk. That is why the badge is cleared on the return value rather than by probing
      // the store for the entry's presence: presence no longer distinguishes the two.
      if (await handleInstall(entry, consent)) {
        clearUpdateAvailable(entry.id);
      }
    },
    [
      askConsent,
      clearUpdateAvailable,
      handleInstall,
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
                  revoked={shownRevocation(entry) !== null}
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
                      {/* §69 — the tab that MATTERS for a withdrawal. Pulling the
                          plugin from the index is the normal response, and once it is
                          pulled Browse and Updates both lose it (they iterate the
                          registry), so this is the only screen left. Resolved from the
                          installed manifest, which needs no registry entry at all. */}
                      <PluginRevokedNotice
                        onRemove={() =>
                          void handleUninstall(plugin.manifest.id)
                        }
                        revocation={revocationFor(
                          plugin.manifest.id,
                          plugin.manifest.version,
                          revocations,
                        )}
                      />
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
                  revoked={shownRevocation(entry) !== null}
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

/** The running app version, or null when it cannot be read. */
async function currentAppVersion(): Promise<null | string> {
  try {
    return (await getVersion()) ?? null;
  } catch (err) {
    // Not an install failure. Nothing about the plugin is known to be wrong, so the
    // caller proceeds — see the direction-of-doubt note in `plugins/engines.ts`.
    logger.warn("[Marketplace] could not read the app version:", err);
    return null;
  }
}

/**
 * The refusal to show when the running app is below `engines`' floor, else null.
 *
 * One helper rather than the same block at three sites: pre-download, post-download and
 * update must reach the SAME verdict, and copies are how they stop doing that.
 *
 * The app version is read only once a floor has actually been parsed — most manifests
 * state either no floor this can evaluate or one that is met, and there is no reason to
 * ask the backend for our own version to answer a question with no floor in it.
 *
 * Read per call rather than once on mount: a `null` window during the first frames would
 * silently skip the check for precisely the impatient click the gate exists to stop.
 */
async function floorRefusal(
  engines: undefined | { baram: string },
  t: Translate,
): Promise<null | string> {
  if (parseBaramFloor(engines?.baram) === null) return null;
  const appVersion = await currentAppVersion();
  // `unmetBaramFloor` treats an unreadable version as "no opinion" too; narrowing it here
  // is what lets the refusal name the version the reader is actually on.
  if (appVersion === null) return null;
  const floor = unmetBaramFloor(appVersion, engines);
  if (floor === null) return null;
  return t("plugin.error.appTooOld", { current: appVersion, required: floor });
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
