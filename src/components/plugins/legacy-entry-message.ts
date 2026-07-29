import type { RegistryEntry } from "../../plugins/types";

/**
 * Why a registry entry cannot be installed, in the user's words.
 *
 * §260 Phase 5 — the live registry still lists plugins written before the trust model.
 * `validateManifest` refuses a trust-less manifest, so without this the user downloads first
 * and meets a validation error second.
 *
 * §260 Phase 6 code review round 2 — ONE home for the sentence, for the reason
 * `capability-gate.ts` gives about its own message: two copies is how one ends up saying
 * something subtly different. `PluginMarketplace` and `PluginDetail` each had their own, and
 * they had to stay identical by hand. It lives in its own module rather than in either
 * component because the marketplace imports the detail view, so exporting from there would
 * make the dependency circular.
 *
 * The remedy depends on WHY the entry was demoted, and the original text points the wrong way
 * for one of the two reasons: an entry naming a capability this build cannot enforce usually
 * means the registry is NEWER than the app, so "ask the author to declare a tier" tells them to
 * do something they already did.
 */
export function legacyEntryMessage(entry: RegistryEntry): string {
  return entry.demotedBecause === "unknown-capability"
    ? "This plugin needs a capability this version of Baram does not know about, so it " +
        "cannot be installed. Update Baram and try again."
    : "This plugin predates Baram's plugin trust model and cannot be installed. " +
        "Ask the author to publish a manifest that declares a trust tier.";
}
