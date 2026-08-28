// §69 / §260 Phase 5 — the install transaction: stage a download, verify it against
// what the caller's consent covers, commit it over any installed version, and roll
// back if anything along the way fails. Extracted out of `usePluginActions.ts`'s
// `handleInstall`, where six review rounds of §260 Phase 5 and #261 put this sequence
// together; the comments below explain defects that were found the hard way, and they
// moved with the code.
//
// A `.ts` rather than a `.tsx`, matching its caller and for the same reason:
// `stageValidateAndCommit` carries a template literal (the `${e.field}: ${e.message}`
// join below), and `plugin-ui-i18n.test.tsx` scans only `.tsx` files in this directory
// for hardcoded strings. Renaming this to `.tsx` would put that literal back in scope
// and turn the scanner red.
import { getVersion } from "@tauri-apps/api/app";

import type { Translate } from "../../i18n/useTranslation";
import type { RustCommittedPluginInfo } from "../../ipc/plugin-invoke";
import type {
  InstalledPlugin,
  PluginConsent,
  RegistryEntry,
} from "../../plugins/types";

import {
  pluginInstallCommit,
  pluginInstallDiscard,
  pluginInstallStage,
} from "../../ipc/plugin-invoke";
import { parseBaramFloor, unmetBaramFloor } from "../../plugins/engines";
import { validateManifest } from "../../plugins/manifest";
import { consentGaps } from "../../plugins/plugin-consent";
import { pluginLoader } from "../../plugins/plugin-loader";
import { usePluginStore } from "../../stores/system/plugin";
import { logger } from "../../utils/logger";

/**
 * §260 Phase 5 — download the entry to a staging directory, verify the ARCHIVE (not
 * the registry's claim) against `consent`, and only then commit it over any installed
 * version. The caller has already collected `consent` against the registry entry,
 * which is a claim the registry makes; the manifest inside the ZIP is the truth, and
 * checking that they agree is what makes the claim worth consenting to at all —
 * otherwise a registry (or a swapped download URL that still matches its checksum
 * entry) could advertise "sandboxed" and ship "trusted", and the user would have
 * approved the wrong thing.
 *
 * ‼️ #261 — EVERY CHECK BELOW RUNS BEFORE ANYTHING INSTALLED IS TOUCHED.
 *
 * `pluginInstallStage` downloads and extracts to a staging directory; only
 * `pluginInstallCommit` swaps. So a refusal below is a `pluginInstallDiscard` of files
 * nobody has yet, rather than the previously installed version already deleted and
 * unrecoverable. This is what lets `handleUpdate` stop composing uninstall with
 * install.
 *
 * On failure, discards the stage, restores the previous version's runtime if this was
 * an update that had already unloaded it, and rethrows — the caller's job is only to
 * turn that into `setError` + `return false`.
 */
export async function stageValidateAndCommit(
  entry: RegistryEntry,
  consent: PluginConsent,
  t: Translate,
): Promise<{ checksum: string; committed: RustCommittedPluginInfo }> {
  // Non-null only while a staged copy exists that nothing has committed yet.
  let pendingStage: null | string = null;
  // The record of the version this is replacing, once its runtime has been torn
  // down — non-null only while a restart is owed.
  let unloaded: InstalledPlugin | null = null;
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
    const checksum = staged.checksum;
    const manifest = staged.manifest;

    // §260 Phase 5 code review (L3) — ONE cleanup site, and plain `throw` statements.
    //
    // The checks below used to call an `await reject(...)` helper that rolled back and
    // threw. Correct at runtime, but not compiler-checkable: `await` of a
    // `Promise<never>` gives TypeScript no control-flow narrowing, so a fourth check
    // appended after one would compile and run. ‼The reviewer's suggested
    // `return reject(...)` narrows but BREAKS the error path — a `return` inside `try`
    // hands control out of the block, so `catch` never sees the rejection and no error
    // badge appears (four tests caught this). A `throw` statement does both.
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
      usePluginStore.getState().installedPlugins[entry.id] !== undefined;
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
    unloaded = usePluginStore.getState().installedPlugins[manifest.id] ?? null;
    await pluginLoader.unloadPlugin(manifest.id);
    // The digest pins the manifest to the one every check above judged. A stage
    // sits on disk across this whole block — an app-version IPC and the entire
    // `unloadPlugin` teardown — during which a trusted-tier plugin is still running
    // in the main realm. Without it, the manifest that gets recorded, granted and
    // loaded need not be the one that was consented to (#261 security review).
    const committed = await pluginInstallCommit(
      pendingStage,
      entry.id,
      staged.manifest_sha256,
    );
    return { checksum, committed };
  } catch (err) {
    if (pendingStage !== null) {
      await pluginInstallDiscard(pendingStage).catch((e: unknown) =>
        logger.error("[Marketplace] discarding the staged install failed:", e),
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
    throw err;
  }
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
export async function floorRefusal(
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
