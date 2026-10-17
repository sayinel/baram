// §69 — every mutation the plugin UI can start, in one place.
//
// ‼️ THE BODIES BELOW MOVED VERBATIM out of `PluginMarketplace.tsx`. They are what six
// review rounds of §260 Phase 5 and #261 produced — install staging so a failed download
// cannot destroy the installed version, re-verification of the downloaded manifest against
// what the user consented to, an in-flight guard against a double-click that would
// interleave two commits, and restoration of the previous runtime when a commit fails. The
// comments explain defects that were found the hard way; they move with the code.
//
// The stage→validate→unload→commit→rollback sequence itself has since moved on again, to
// `install-transaction.ts`'s `stageValidateAndCommit`: it depends on nothing React (store
// reads go through `usePluginStore.getState()`, never a hook), so this hook now only does
// the React-shaped parts — consent, the in-flight guard, and turning a transaction failure
// into `setError` + `return false`.
//
// Enable/disable — `handleToggleEnabled` and `handleToggleBuiltin` — touches none of the
// above and lives in `use-plugin-toggles.ts`; this hook composes it, so callers see one
// return value.
//
// A `.ts` rather than a `.tsx` on purpose: `handleInstall` carries a template literal, and
// `plugin-ui-i18n.test.tsx` scans only `.tsx` in this directory. The consent dialog's JSX
// therefore stays in the shell, driven by the `pendingConsent`/`settleConsent` pair below.
import { useCallback, useEffect, useRef, useState } from "react";

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
import { pluginUninstall } from "../../ipc/plugin-invoke";
import { devFolderHoldsId } from "../../plugins/dev-plugins";
import {
  carryCodeBlocks,
  claimedConsent,
  codeBlockReask,
  consentRequired,
  recordedConsent,
} from "../../plugins/plugin-consent";
import { pluginLoader } from "../../plugins/plugin-loader";
import { revocationFor, revocationReason } from "../../plugins/revocation";
import { usePluginStore } from "../../stores/system/plugin";
import { floorRefusal, stageValidateAndCommit } from "./install-transaction";
import { legacyEntryMessage } from "./legacy-entry-message";
import { usePluginToggles } from "./use-plugin-toggles";

/** What the consent dialog is currently asking about, if anything. */
export interface PendingConsent {
  consent: PluginConsent;
  /** Install vs update — the caller's knowledge, not derived from the reason (M2). */
  intent: "install" | "update";
  name: string;
  prior?: PluginConsent;
}

export function getPluginStatus(
  id: string,
  installing: Record<string, boolean>,
  plugin: undefined | { enabled: boolean },
): PluginStatus {
  if (installing[id]) return "installing";
  if (!plugin) return "not-installed";
  return plugin.enabled ? "enabled" : "disabled";
}

/**
 * `registryIndex` is an argument rather than read here: the shell owns the fetch, and
 * `handleUpdate` re-resolves the LISTING out of it rather than trusting the entry it was
 * handed (§260 Phase 5 code review, H2).
 */
export function usePluginActions(registryIndex: null | RegistryIndex) {
  const { t } = useTranslation();
  const {
    installedPlugins,
    addPlugin,
    removePlugin,
    revocations,
    setError,
    setInstalling,
    clearUpdateAvailable,
  } = usePluginStore(
    useShallow((s) => ({
      addPlugin: s.addPlugin,
      clearUpdateAvailable: s.clearUpdateAvailable,
      installedPlugins: s.installedPlugins,
      removePlugin: s.removePlugin,
      revocations: s.revocations,
      setError: s.setError,
      setInstalling: s.setInstalling,
    })),
  );

  const { handleToggleBuiltin, handleToggleEnabled } = usePluginToggles();

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

  /**
   * §260 Phase 5 — consent, then hand off to `stageValidateAndCommit` for the
   * download/verify/commit transaction.
   *
   * Every check the transaction runs happens BEFORE `addPlugin`. That closes a gap
   * this flow has carried since §69: the record used to be persisted first and
   * validated only inside `loadPlugin`, whose rejection merely set an error string —
   * so an invalid manifest stayed in the store, and a plugin declaring
   * `tiptapExtensions` skipped `loadPlugin` entirely and was never validated at all.
   *
   * Returns whether the plugin ended up installed, which `handleUpdate` needs and no
   * other caller uses.
   *
   * `preApproved` is for the update path, which has already settled the registry claim —
   * asking when the record did not cover it. Languages the download adds beyond it are asked
   * about inside the transaction (§394).
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
          setError(entry.id, legacyEntryMessage(entry, t));
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
        // §379 I4 — the reverse of what `plugin_pick_dev_folder` refuses. UX only: Rust's
        // commit refuses a held id anyway; this says so before the dialog and the download.
        if (devFolderHoldsId(entry.id)) {
          setError(entry.id, t("plugin.dev.error.idHeld"));
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
        const claimed = claimedConsent(entry, entry.trust);
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
          // §260 Phase 5 code review (L3) — this MUST stay a `catch`, not a `return`
          // inside `stageValidateAndCommit`'s own `try`: a `return` there would hand
          // control out of that block without ever throwing, so this `catch` would
          // never run and no error badge would appear. See `install-transaction.ts`
          // for why the transaction throws rather than swallowing.
          let checksum: string;
          let committed: RustCommittedPluginInfo;
          try {
            ({ checksum, committed } = await stageValidateAndCommit(
              entry,
              consent,
              t,
              // §394 spec 0073 D4 ① — the same dialog, now listing the languages the
              // download draws; NEW marks what the record lacked. Approving it lets the
              // commit go on.
              async (declared) =>
                (await askConsent({
                  ...codeBlockReask(consent, declared),
                  intent: preApproved ? "update" : "install",
                  name: entry.name,
                })) !== null,
            ));
          } catch (err) {
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
            // §394 spec 0073 D4 ③ — the committed manifest's languages, not the approved ones.
            consent: recordedConsent(consent, committed.manifest),
            enabled: true,
            installedAt: Date.now(),
            installPath: committed.install_path,
            manifest: committed.manifest,
            updatedAt: Date.now(),
          };
          addPlugin(plugin);
          setError(entry.id, null);

          // Load what was just installed — EVERY plugin, including one contributing
          // tiptapExtensions.
          //
          // ‼️ THIS SKIPPED A `tiptapExtensions` MANIFEST until §260 스펙 0050, under the
          // comment "those need restart". That was true when it was written: nothing
          // consumed the field, so a contribution could only reach an editor constructed
          // after the plugin loaded. `src/plugins/editor-surfaces.ts` changed it —
          // `addPluginContributions` installs into every editor already registered as a
          // surface, so a contribution takes effect on the open document immediately.
          //
          // The skip did not tell the user to restart either; it just did nothing. A
          // freshly installed editor plugin sat there inert with no error against it, and
          // the way out was to toggle Enabled off and on — which calls the very
          // `loadPlugin` this line was declining to call. That is how it was found.
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
          try {
            await pluginLoader.loadPlugin(
              committed.install_path,
              committed.manifest,
            );
          } catch (activationError) {
            setError(entry.id, String(activationError));
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
        setError(entry.id, legacyEntryMessage(entry, t));
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
      // §379 I4 — checked here as well as in `handleInstall`, so the refusal comes before the
      // consent dialog rather than after it.
      if (devFolderHoldsId(entry.id)) {
        setError(entry.id, t("plugin.dev.error.idHeld"));
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
      const claimed = claimedConsent(entry, entry.trust);
      const reason = consentRequired(prior, claimed);
      // When the recorded consent already covers this version, record the CLAIMED shape
      // rather than carrying the old one forward — an update that drops a capability
      // must narrow the record too, or the grant outlives the version that needed it.
      const approved =
        reason === null
          ? claimed
          : await askConsent({
              consent: claimed,
              intent: "update",
              name: entry.name,
              prior,
            });
      if (!approved) return;
      // §394 spec 0073 D4 ① — the record's languages ride on the APPROVED claim, as the base
      // the post-download check compares the downloaded manifest's with. Not before: the
      // dialog above has no manifest in hand, and listing the record's languages there would
      // present them as the new version's. Not what gets recorded either: `handleInstall`
      // records the committed manifest's (`recordedConsent`).
      const consent = carryCodeBlocks(approved, prior);

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

  return {
    handleInstall,
    handleToggleBuiltin,
    handleToggleEnabled,
    handleUninstall,
    handleUpdate,
    /**
     * The shell mounts this in BOTH of its returns: install can be started from the list
     * or from the detail view, and the detail view is an early return — mounting the
     * dialog in only one of them would leave the other's `askConsent` promise pending
     * forever.
     */
    pendingConsent,
    settleConsent,
  };
}
