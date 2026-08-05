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
  // De-duplicated: a manifest may legally list a capability twice, and
  // "network, network" in a user-facing error reads like a bug in the app
  // (§260 Phase 5 code review, L5).
  const extra = [
    ...new Set(next.capabilities.filter((cap) => !isCovered(cap, held))),
  ];
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
 * The capabilities a plugin may actually be GRANTED: what its manifest asks for, kept
 * only where the recorded consent covers it.
 *
 * §260 Phase 5 code review (H3) — without this the consent record was an install-time UX
 * artifact: the cross-check proves manifest ⊆ consent when the ZIP lands, and after that
 * nothing consults the record again.
 *
 * ‼️ Honest scope (re-review, R9 — the original version of this comment overstated it, and
 * so did the finding that prompted it). Editing `baram-plugin.json` after install is NOT
 * currently a live escalation: an installed plugin's manifest is read only out of the
 * persisted store record, and `pluginListInstalled` — the one IPC that would re-read the
 * file — has no caller in `src/`. What this guards is the moment that changes. A "refresh
 * installed plugins" feature calling that dead command reintroduces the path immediately,
 * and this is much easier to get right now than to remember then.
 *
 * Against the reachable variant — editing the app's `config.json` directly — the narrowing
 * is inert, because the consent it checks against lives in the same file. That bound is
 * why the TIER half is refused in `narrowToConsent` rather than narrowed: a tier
 * escalation is the one that escapes the Rust broker entirely.
 *
 * An ABSENT consent grants the manifest unchanged. That is not a loophole being left
 * open: dev-folder plugins never have a record (choosing the directory is the consent),
 * and pre-Phase-5 records whose manifest declared no tier cannot load at all. Narrowing
 * those to nothing would break the dev loop while protecting no user.
 */
export function grantableCapabilities(
  manifest: { capabilities: readonly PluginCapability[] },
  consented: PluginConsent | undefined,
): PluginCapability[] {
  if (!consented) return [...manifest.capabilities];
  const held = new Set(consented.capabilities);
  return manifest.capabilities.filter((cap) => isCovered(cap, held));
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
