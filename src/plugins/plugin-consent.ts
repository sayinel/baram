// §260 Phase 5 — what the user agreed to, and whether a later version exceeds it.
//
// ONE rule serves two callers, deliberately: the pre-download prompt decision
// (`consentRequired`) and the post-download check that the manifest inside the ZIP
// matches what the registry advertised. Consent is collected against a registry CLAIM,
// so if those two answers could diverge a registry could advertise "sandboxed" and ship
// "trusted" — the exact attack the second check exists to catch. A second implementation
// of "covered" would be a second place for them to drift apart.
import type { PluginCapability, PluginConsent, PluginTrust } from "./types";

export type ConsentReason = "escalation" | "first-install";

/** What the plugin asks for now — a registry claim, or a downloaded manifest. */
interface CapabilityRequest {
  capabilities: readonly PluginCapability[];
  trust: PluginTrust;
}

/**
 * Does this consent already cover one capability?
 *
 * Exported for the dialog's "NEW" marker, which must agree with `consentGaps` rather
 * than re-deriving coverage: an update narrowing `files` to `files:readonly` raises no
 * gap, so presenting it as newly requested would contradict the same screen's own
 * decision not to block.
 */
export function consentCovers(
  consented: PluginConsent,
  capability: PluginCapability,
): boolean {
  return isCovered(capability, new Set(consented.capabilities));
}

/**
 * Every way `next` exceeds what was consented to, phrased for a user-facing error.
 * Empty means covered.
 */
export function consentGaps(
  consented: PluginConsent,
  next: CapabilityRequest,
): string[] {
  const gaps: string[] = [];
  if (next.trust === "trusted" && consented.trust !== "trusted") {
    gaps.push(
      `it declares trust "trusted" (full access to the app), but "${consented.trust}" was approved`,
    );
  }
  const held = new Set(consented.capabilities);
  const extra = next.capabilities.filter((cap) => !isCovered(cap, held));
  if (extra.length > 0) {
    gaps.push(
      `it requests capabilities that were not approved: ${extra.join(", ")}`,
    );
  }
  return gaps;
}

/**
 * `null` means the recorded consent still covers this install; otherwise, why to ask
 * again. An absent record is "first-install" rather than "escalation" so the dialog can
 * word itself correctly — the two are not the same event to a user.
 */
export function consentRequired(
  consented: PluginConsent | undefined,
  next: CapabilityRequest,
): ConsentReason | null {
  if (!consented) return "first-install";
  return consentGaps(consented, next).length > 0 ? "escalation" : null;
}

/**
 * Capabilities are ORDERED, not merely a set: holding the writable form implies holding
 * the readonly one. Rust already encodes the same relationship as
 * `CapabilityRequirement::AnyOf` on each brokered op, which is why a read is admitted for
 * either grant; this is the consent-side half of that fact.
 *
 * Without it, a plain subset test prompts on an update that NARROWS a grant
 * (`files` → `files:readonly`) — a false alarm that trains users to click through the
 * dialog that exists to stop them.
 */
const IMPLIED_BY: Partial<Record<PluginCapability, PluginCapability>> = {
  "editor:readonly": "editor",
  "files:readonly": "files",
};

function isCovered(
  needed: PluginCapability,
  held: ReadonlySet<PluginCapability>,
): boolean {
  if (held.has(needed)) return true;
  const stronger = IMPLIED_BY[needed];
  return stronger !== undefined && held.has(stronger);
}
