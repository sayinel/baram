// §382 — the community list's own rules, applied after the rules every registry entry gets
// (`registry-client.ts` `normalizeIndex`), and the merge of the two lists.
//
// Pure: no store, no IPC. The CHANNEL is decided by which function an entry went through —
// by which file it came from — and never read off the wire (spec 0058 §9.1).
import type { RegistryEntry } from "./types";

import { logger } from "../utils/logger";

/** Ids Baram publishes under (spec 0058 §7.2 gate 2, §8.3): `index.json` only. */
const FIRST_PARTY_ID_PREFIX = "baram-";

/**
 * GitHub's login grammar: 1–39 ASCII letters, digits and single hyphens, neither first nor
 * last — the grammar spec 0058 §7.2 gate 2 applies to a submission. The publisher is the one
 * registry-authored string §382 puts on screen, so its character set is closed at the door
 * (spec 0058 §2, lesson 2).
 */
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/u;

/**
 * Community entries after the shared normalization: drop what `community.json` may not
 * carry, demote what it may carry but this build will not install, stamp the channel.
 */
export function applyCommunityRules(
  normalized: RegistryEntry[],
): RegistryEntry[] {
  return normalized.flatMap((entry) => {
    const refusal = ineligibility(entry);
    if (refusal !== null) {
      logger.warn(
        `[Registry] dropping community entry ${entry.id}: ${refusal}`,
      );
      return [];
    }
    const stamped: RegistryEntry = { ...entry, channel: "community" };
    if (stamped.trust !== "trusted") return [stamped];
    // ‼️ G2 held by the app (spec 0058 §4). Gate 7 refuses to publish this, so reaching here
    // means the registry pipeline is wrong — and the consent dialog's community sentence
    // ("the capabilities below are everything this plugin can do") is true only of a
    // sandboxed plugin. Demoted rather than dropped: the entry is well-formed, and a listed
    // entry with a reason is easier to diagnose than a missing one.
    logger.warn(
      `[Registry] ${entry.id} is a community entry declaring full trust — ` +
        "community plugins are sandboxed only; treating the entry as legacy",
    );
    delete stamped.trust;
    stamped.demotedBecause = "community-trusted";
    return [stamped];
  });
}

/**
 * The community list's URL, beside the index — resolved with the URL parser, the way
 * `revocationUrlFor` finds `revoked.json`. `null` when the registry URL is not a URL.
 */
export function communityUrlFor(registryUrl: string): null | string {
  try {
    return new URL("community.json", registryUrl).toString();
  } catch {
    return null;
  }
}

export function isGithubLogin(value: unknown): value is string {
  return typeof value === "string" && GITHUB_LOGIN.test(value);
}

/**
 * One list out of two files. **First-party wins** an id both files claim: the community copy
 * is dropped and the first-party one served.
 *
 * ‼️ NOT `dropAmbiguousIds`' rule, deliberately. Inside one file an id claimed twice resolves
 * to neither, because document order is an attacker's choice. Across files there is no
 * order to choose — the file IS the channel — and serving neither would let one community
 * entry delete a first-party plugin from every user's marketplace (spec 0058 §9.1).
 */
export function mergeChannels(
  firstParty: readonly RegistryEntry[],
  community: readonly RegistryEntry[],
): RegistryEntry[] {
  const firstPartyIds = new Set(firstParty.map((entry) => entry.id));
  const shadowed = community.filter((entry) => firstPartyIds.has(entry.id));
  if (shadowed.length > 0) {
    logger.warn(
      `[Registry] ${shadowed.length} community entr${shadowed.length === 1 ? "y shares" : "ies share"} ` +
        `an id with a first-party entry — serving the first-party one: ${shadowed.map((e) => e.id).join(", ")}`,
    );
  }
  return [
    ...firstParty,
    ...community.filter((entry) => !firstPartyIds.has(entry.id)),
  ];
}

/** Why `community.json` may not carry this entry, or `null`. Dropped, not demoted. */
function ineligibility(entry: RegistryEntry): null | string {
  if (entry.id.startsWith(FIRST_PARTY_ID_PREFIX)) {
    return `the "${FIRST_PARTY_ID_PREFIX}" id prefix is reserved for Baram's own plugins`;
  }
  // Absent reads as "plugin", the convention `RegistryEntry.kind` documents.
  if ((entry.kind ?? "plugin") !== "plugin") {
    return `kind ${JSON.stringify(entry.kind)} — community themes are not listed`;
  }
  if (!isGithubLogin(entry.publisher)) {
    return "publisher is missing or not a GitHub login";
  }
  if (!isPositiveId(entry.publisherId)) {
    return "publisherId is missing or not a positive integer";
  }
  if (!isPositiveId(entry.repoId)) {
    return "repoId is missing or not a positive integer";
  }
  return null;
}

/** A GitHub numeric id: a positive integer JS can hold exactly. */
function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
