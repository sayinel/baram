// §260 — plugin trust tier helpers. A manifest predating the tier model has no
// `trust`; such plugins must not run until re-validated by the user.
import type { PluginManifest, PluginTrust } from "./types";

const TIERS: readonly PluginTrust[] = ["sandboxed", "trusted"];

export function isLegacyManifest(
  manifest: Pick<PluginManifest, "trust">,
): boolean {
  return pluginTrustOf(manifest) === null;
}

export function pluginTrustOf(
  manifest: Pick<PluginManifest, "trust">,
): null | PluginTrust {
  const t = (manifest as { trust?: unknown }).trust;
  return TIERS.includes(t as PluginTrust) ? (t as PluginTrust) : null;
}
