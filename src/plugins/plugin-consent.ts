// §260 Phase 5 — what the user agreed to, and whether a later version exceeds it.
//
// ONE rule (`consentGaps`) serves THREE callers, deliberately: the UPDATE half of
// `usePluginActions.ts`'s install/update path (`consentRequired` — install always asks,
// unconditionally), the post-download check that the manifest inside the ZIP matches what
// the registry advertised (`stageValidateAndCommit` in `install-transaction.ts`), and §379's
// dev-folder consent gate (`devConsentToAsk` in `dev-plugins.ts`, which guards startup load,
// a folder pick, and Reload alike — every point a dev folder's code is about to run). Consent
// is collected against a registry CLAIM, so if the first two answers could diverge a registry
// could advertise "sandboxed" and ship "trusted" — the exact attack the second check exists
// to catch. A second implementation of "covered" would be a second place for them to drift
// apart.
//
// The publisher rule this file adds (§382) is registry-claim-only by design (plan 0104
// P18): the second and third callers both build their `next` as `{capabilities, trust}`
// explicitly (`install-transaction.ts`'s call and `devConsentToAsk`'s `request`), so
// `next.channel` is undefined for them and the rule never fires — see `claimedConsent`
// below for the matching write side.
import type {
  PluginCapability,
  PluginConsent,
  PluginTrust,
  RegistryChannel,
  RegistryEntry,
} from "./types";

export type ConsentReason = "escalation" | "first-install";

/** What the plugin asks for now — a registry claim, or a downloaded manifest. */
interface CapabilityRequest {
  capabilities: readonly PluginCapability[];
  /** §382 — set on a registry claim; a downloaded manifest names no channel. */
  channel?: RegistryChannel;
  /** §382 — the listing's publisher id, compared only when `channel` is `community`. */
  publisherId?: number;
  trust: PluginTrust;
}

/**
 * §382 — the consent a registry listing asks for: what the dialog shows and what gets
 * recorded. `trust` is passed separately because the caller has already refused a
 * trust-less (legacy) entry, and TS does not narrow the entry's type from that check.
 *
 * One builder for the install and the update path (`usePluginActions`), so both write the
 * same provenance. The publisher is copied for a COMMUNITY listing only. First-party UPDATES
 * are exempt from `consentGaps`' publisher rule by that rule's own `next.channel` test,
 * whatever the record holds; what an id-less first-party record buys is the other direction —
 * a later COMMUNITY listing under the same id finds no recorded id and asks (plan 0104 P20).
 */
export function claimedConsent(
  entry: RegistryEntry,
  trust: PluginTrust,
): PluginConsent {
  const consent: PluginConsent = {
    capabilities: [...entry.capabilities].sort(),
    trust,
  };
  if (entry.channel !== undefined) consent.channel = entry.channel;
  if (entry.channel === "community") {
    if (entry.publisher !== undefined) consent.publisher = entry.publisher;
    if (entry.publisherId !== undefined)
      consent.publisherId = entry.publisherId;
  }
  return consent;
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
  // §382 — a community plugin whose publisher ACCOUNT changed is a different party asking,
  // whatever it asks for (spec 0058 §9.2). Compared by the numeric GitHub id: a login can be
  // renamed, and a deleted one registered again by someone else. An absent recorded id means
  // either a consent written before §382, or one approved against a FIRST-PARTY listing (which
  // carries no publisher — `registry-client.ts` strips one if the wire ever sent it) — either
  // way there is nothing to hold a later community claim's id against, so it counts as a
  // change. A first-party listing is itself exempt from this rule: it carries no publisher,
  // and its channel is the file Baram's own release pipeline writes.
  if (
    next.channel === "community" &&
    consented.publisherId !== next.publisherId
  ) {
    gaps.push(
      `it is published by a different GitHub account (id ${String(next.publisherId)}) ` +
        `than the one approved (${consented.publisherId === undefined ? "none recorded" : `id ${consented.publisherId}`})`,
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
 * open: a DEV build's dev-folder load passes none (choosing the directory is the consent
 * there); a release build's dev load never gets here without one (`resolveConsent` refuses
 * it, §379 F2); and pre-Phase-5 records whose manifest declared no tier cannot load at all.
 * Narrowing those to nothing would break the dev loop while protecting no user. (An
 * installed record WITH a tier but no consent also passes none — spec 0058 0단계 (f).)
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
