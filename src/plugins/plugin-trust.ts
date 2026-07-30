// §260 — plugin trust tier helpers. A manifest predating the tier model has no
// `trust`; such plugins must not run until re-validated by the user.
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
 */
export function legacyInstallMessage(): string {
  return (
    "This plugin was installed before Baram's plugin trust model, so it can no longer be " +
    "loaded. Use Remove on the Installed tab — then, if it is still available in the " +
    "marketplace, install it again to review what it is allowed to do."
  );
}

export function pluginTrustOf(
  manifest: Pick<PluginManifest, "trust">,
): null | PluginTrust {
  const t = (manifest as { trust?: unknown }).trust;
  return TIERS.includes(t as PluginTrust) ? (t as PluginTrust) : null;
}
