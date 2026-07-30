// §260 — plugin trust tier helpers. A manifest this build cannot place in a tier must not run
// until re-validated by the user.
//
// `isLegacyManifest` is true for THREE different situations, and the header used to name only
// the first: a manifest predating the tier model (no `trust`), one declaring a tier a LATER
// Baram introduced, and one whose `trust` is simply not a tier name. They need different
// remedies — ask the author, update the app, fix the manifest — which is what
// `legacyInstallMessage` exists to sort out. "Legacy" is a slight misnomer kept for continuity.
import type { PluginManifest, PluginTrust } from "./types";

const TIERS: readonly PluginTrust[] = ["sandboxed", "trusted"];

export function isLegacyManifest(
  manifest: Pick<PluginManifest, "trust">,
): boolean {
  return pluginTrustOf(manifest) === null;
}

/**
 * Why an already-INSTALLED plugin cannot be loaded any more, in the user's words.
 *
 * The sibling of `legacyEntryMessage`, which covers a registry ENTRY. This one covers a
 * record on the user's disk, and it exists because the v0.5.0 release review found that the
 * premise everything else assumed is false: v0.4.0 and v0.4.1 both shipped with the
 * marketplace open, no `trust` requirement in `validateManifest`, and the DEFAULT registry
 * URL already pointing at the live index. The #259 release gate that was supposed to have
 * prevented these records merged 2026-07-23 — two days AFTER v0.4.1 was tagged — so it never
 * shipped in any release. Those installs are real.
 *
 * `validateManifest` now requires `trust`, so such a record throws on every startup. The
 * generic validator text ("trust is required and must be …") describes the schema rather
 * than the remedy, and the usual remedy does not apply: `checkForUpdates` skips a
 * trust-less registry entry, so no update is ever offered. Uninstall is the only way out,
 * and nothing said so.
 *
 * It does not promise a reinstall. `baram-ai-summary` was withdrawn in §260 Phase 6, so for
 * that plugin no republished version will ever exist — hence "if it is still available"
 * rather than "install it again".
 *
 * It names **Remove**, and names the Installed tab, because that is the control that exists:
 * the first draft said "Uninstall it here", which is the PluginCard label. That card is
 * rendered only by Browse, Updates and the detail view — all three iterate the REGISTRY — so
 * for a plugin whose entry has been withdrawn the sentence pointed at a button on a screen
 * the user could not reach, from text that was not displayed there either. Advice naming the
 * wrong control is worse than no advice: it makes the user look for something absent.
 *
 * It takes the MANIFEST rather than no argument, for the reason `legacyEntryMessage` takes the
 * entry: an absent tier and an UNRECOGNISED one need opposite remedies, and `isLegacyManifest`
 * cannot tell them apart — it is `pluginTrustOf(...) === null`, so a tier introduced by a later
 * Baram is "legacy" too. Telling the user a manifest from the future "predates the trust model"
 * points them at the author when the fix is to update the app. `demotedBecause` (`types.ts`)
 * exists to remove exactly this conflation on the registry side; a no-argument function here
 * would have reintroduced it on the installed side.
 */
export function legacyInstallMessage(
  manifest: Pick<PluginManifest, "trust">,
): null | string {
  // Not this function's case at all: the tier is one this build enforces, so whatever else is
  // wrong with the manifest is a schema problem. Gating here rather than at the call site keeps
  // the whole discrimination in one readable place.
  if (!isLegacyManifest(manifest)) return null;

  const trust = (manifest as { trust?: unknown }).trust;
  if (trust === undefined) {
    return (
      "This plugin was installed before Baram's plugin trust model, so it can no longer be " +
      "loaded. Use Remove on the Installed tab — then, if it is still available in the " +
      "marketplace, install it again to review what it is allowed to do."
    );
  }
  // A non-empty STRING is a genuine declaration this build does not know — most likely a tier
  // added by a later Baram, so updating is the remedy.
  if (typeof trust === "string" && trust.length > 0) {
    return (
      "This plugin declares a trust tier this version of Baram does not recognize, so it " +
      "cannot be loaded. Update Baram and try again."
    );
  }
  // `null`, `""`, `0`, `false`, a number… present but not a declaration of anything. Found by
  // probing after the fix for the unrecognized-tier case: EVERY one of these was being told to
  // "Update Baram", which is a dead end — no version will ever accept `trust: null`. Returning
  // null hands them the schema text ("trust is required and must be …"), which is the only
  // actionable message. Same wrong-remedy class as the case above, in the other direction.
  return null;
}

export function pluginTrustOf(
  manifest: Pick<PluginManifest, "trust">,
): null | PluginTrust {
  const t = (manifest as { trust?: unknown }).trust;
  return TIERS.includes(t as PluginTrust) ? (t as PluginTrust) : null;
}
