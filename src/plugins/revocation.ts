// §69 plugin revocation — deciding what an installed plugin's listed revocation means.
//
// Baram hosts plugin bundles itself, which is a cost (third-party code is distributed
// from our domain) whose only compensating benefit is the ability to respond. Without
// this, pulling an entry from the index stops NEW installs and does nothing for anyone
// who already has it — the same position Obsidian is in, except Obsidian at least does
// not host the bytes.
//
// Severity exists because "removed" is not one thing. Obsidian's removal list is 369
// entries and most read like "Features merged into Commander plugin" or "no response
// from developer after 30 days" — hygiene, not danger. Refusing to load those would
// take away a working feature for a bookkeeping reason. Refusing to load nothing would
// leave an infostealer running. One severity cannot serve both.

import type { VersionRange } from "./version-range";

import { logger } from "../utils/logger";
import { matchesRange } from "./version-range";

export interface RevocationEntry {
  id: string;
  /** Free English prose, shown when `reasonKey` is absent or unknown. */
  reason: string;
  /** Optional i18n key. Reasons are written by hand, so most will not have one. */
  reasonKey?: string;
  severity: RevocationSeverity;
  /**
   * ISO date the withdrawal took effect. Nothing renders it — the spec calls it
   * "display only", but no surface reads it, so today it is a record for whoever opens
   * the list. Said plainly here so the next author does not assume a user will see it.
   */
  since?: string;
  versions: VersionRange;
}

export interface RevocationList {
  revoked: RevocationEntry[];
  /**
   * Monotonic publish counter. Absent means 0.
   *
   * ‼️ THIS IS WHAT MAKES A SIGNATURE WORTH ANYTHING, and the registry's own history is the
   * proof. `{"version":1,"revoked":[]}` was the live document for 31 hours (`395b914` →
   * `aa4a218`). Sign the list and that empty document acquires a VALID signature — one that
   * stays valid forever. An attacker who can serve the origin then replays yesterday's signed
   * empty list and every revocation silently disappears, signature and all. Signing alone
   * closes forgery and not this.
   *
   * So a fetched list must never move the counter BACKWARDS. Equal is fine — re-fetching the
   * current list is the common case, and with a signature in force the same counter cannot
   * carry different content.
   */
  sequence: number;
  version: number;
}

/**
 * What the app does about a revoked plugin.
 *
 * - `malicious` — refuse to load, say why, offer removal. It does NOT delete files:
 *   revocation is a power that can misfire (Microsoft publicly apologised for pulling
 *   extensions used by millions), and a refused load is reversible where a deleted
 *   directory is not.
 * - `vulnerable` — load, but warn. The plugin is not hostile; the user should update.
 * - `unlisted` — do nothing to an installed copy. Hygiene only; blocks new installs.
 */
export type RevocationSeverity = "malicious" | "unlisted" | "vulnerable";

/** Severity ranking, so the worst applicable entry is the one that governs. */
const SEVERITY_RANK: Record<RevocationSeverity, number> = {
  malicious: 3,
  unlisted: 1,
  vulnerable: 2,
};

const SEVERITIES = Object.keys(SEVERITY_RANK) as RevocationSeverity[];

/** An empty list. The shape callers get before the first fetch ever succeeds. */
export const EMPTY_REVOCATIONS: RevocationList = {
  revoked: [],
  sequence: 0,
  version: 1,
};

/**
 * The oldest publish this build will accept, for a client that has stored nothing yet.
 *
 * ‼️ Monotonicity alone cannot protect a FRESH INSTALL: with no stored list there is no
 * counter to compare against, so a replayed old-but-validly-signed list is accepted on first
 * run — which is exactly when the user has no other protection either. A floor compiled into
 * the binary gives that client a starting point, the same way the updater pins a version.
 *
 * ‼️ AND IT IS NOW THE ONLY CROSS-RESTART DEFENCE, which raises what a forgotten bump costs.
 * The high-water mark is deliberately not persisted (see `partialize` in
 * `stores/system/plugin.ts`: persisting it handed an in-realm attacker a durable primitive and
 * blocked the repair that makes a poisoned stored list survivable). So every launch starts from
 * this number, and a replay of a genuinely-published list newer than it is accepted after a
 * restart. Bumping it at release time is what keeps that window one release long.
 *
 * Bump it to the sequence then live. It can only ever be raised: setting it above the live
 * sequence makes every client refuse the real list — pinned by `is at or above the floor this
 * build refuses to go below` in `__tests__/revocation.test.ts`.
 */
export const MINIMUM_REVOCATION_SEQUENCE = 1;

/**
 * The largest counter that can ever be believed.
 *
 * ‼️ WITHOUT AN UPPER BOUND ONE ANSWER CAN PARK THE FLOOR OUT OF REACH (code review
 * CRITICAL-1). `Number.isSafeInteger(9007199254740991)` is true, so an answer carrying
 * `MAX_SAFE_INTEGER` raised the mark above every counter the registry will ever publish and
 * refused every genuine list after it — reproduced at sequence 2, 3, 99 and 1000000. The
 * attacker is the one `plugin-lifecycle.ts` already models: a trusted plugin that patches
 * `window.__TAURI_INTERNALS__.invoke` and answers the refresh itself.
 *
 * ‼️ It bounds the damage; it does not prevent it, and the first version of this comment said
 * "permanent-disarm primitive" as though the bound closed that. It did not — a poison at
 * 1,000,000 refuses everything real just as effectively as one at `MAX_SAFE_INTEGER`. What
 * removed the PERMANENCE is that the mark is no longer persisted (see `partialize` in
 * `stores/system/plugin.ts`); this constant only keeps a claimed counter inside a range the
 * registry could conceivably reach, so the in-session damage is bounded too.
 *
 * A million is not a guess about registries; it is a number no honest publish count reaches
 * (one revocation a day for 2,700 years). A value above it is refused outright rather than
 * clamped: clamping would silently accept a document that is lying about its position.
 */
export const MAXIMUM_REVOCATION_SEQUENCE = 1_000_000;

/** Whether this revocation stops the plugin from running at all. */
export function blocksLoad(entry: null | RevocationEntry): boolean {
  return entry?.severity === "malicious";
}

/**
 * Whether a fetched list is at or above the counter this registry has already reached.
 *
 * Refusing a lower counter is the half signing cannot do — see `sequence` on `RevocationList`
 * for why a valid signature on an old empty list is the actual attack.
 *
 * ‼️ IT COMPARES AGAINST THE FLOOR, NOT AGAINST THE STORED LIST (code review CRITICAL-1). The
 * stored list's own counter looked like the obvious thing to compare with, and it is itself
 * poisonable: `revocations` is persisted, so an unverified answer carrying a huge counter
 * became a permanent ceiling that survived restarts. The floor passed in is raised only by a
 * VERIFIED fetch, which is what keeps a fabricated counter out of it. Equality is accepted —
 * re-fetching the current list is every ordinary refresh.
 */
export function meetsRevocationFloor(
  fetched: RevocationList,
  floor: number = MINIMUM_REVOCATION_SEQUENCE,
): boolean {
  return fetched.sequence >= floor;
}

/**
 * Normalise an unknown payload into a list, or null if the DOCUMENT is unreadable.
 *
 * Two kinds of malformation, two different answers, and conflating them is a bug:
 *
 * - A bad **entry** is dropped and the rest of the list stands. One typo must not take
 *   the other revocations down with it, in either direction.
 * - A bad **document** returns null so the caller can keep whatever it already had.
 *   Returning an empty list here would let a garbled deploy — or a host serving
 *   nonsense — silently replace real revocations with none.
 *
 * A document that is well-formed and genuinely empty is NOT null: withdrawing a
 * revocation has to be possible, or a false positive could never be undone.
 */
export function normalizeRevocationList(raw: unknown): null | RevocationList {
  if (raw === null || typeof raw !== "object") return null;
  const doc = raw as {
    revoked?: unknown;
    sequence?: unknown;
    version?: unknown;
  };
  // An unknown document version is unreadable, not "readable under v1 rules". A future
  // v2 that changed what a severity MEANS would otherwise be applied with v1 semantics
  // by every old client — the precise outcome a version field exists to prevent. Keeping
  // the stored list is the safe answer, and the same one an unreadable document gets.
  if (doc.version !== undefined && doc.version !== 1) return null;
  if (!Array.isArray(doc.revoked)) return null;
  const revoked = doc.revoked.filter((entry) => {
    if (isRevocationEntry(entry)) return true;
    // Dropping silently is what made a mis-authored entry undetectable: the document
    // parses, the deploy looks fine, and the plugin keeps running everywhere. This
    // cannot reach the operator, but it does reach a user's log and a bug report.
    logger.warn("[Revocation] dropped an unreadable entry:", entry);
    return false;
  });
  return { revoked, sequence: readSequence(doc.sequence), version: 1 };
}

/**
 * The counter a fetched list must reach: the higher of this build's floor and what this
 * registry has already been seen to publish.
 *
 * ‼️ EXTRACTED BECAUSE THE COMPILED FLOOR HAD NO TEST AT ALL (code review HIGH-1). Deleting
 * `MINIMUM_REVOCATION_SEQUENCE` from the expression left 54/54 green — the constant this
 * feature calls its only cross-restart defence was pinned by nothing, while the direction that
 * BRICKS clients (a floor above the live counter) was pinned twice.
 *
 * `minimum` is a parameter so the arithmetic can be exercised at a floor that is not 0.
 * Honest bound: with the shipped value at 0, a test can pin this function's arithmetic but
 * cannot distinguish "the default is `MINIMUM_REVOCATION_SEQUENCE`" from "the default is 0".
 * That half becomes real the moment the constant is raised, which is the same commit that arms
 * verification.
 */
export function revocationFloorFor(
  seen: Record<string, number>,
  registryUrl: string,
  minimum: number = MINIMUM_REVOCATION_SEQUENCE,
): number {
  return Math.max(minimum, seen[registryUrl] ?? 0);
}

/**
 * The revocation governing `id` at `version`, or null.
 *
 * When several entries match, the most severe wins. A plugin can legitimately be listed
 * twice — say `unlisted` because the author went quiet, and later `malicious` for one
 * bad version range — and taking the first match would let the bookkeeping entry hide
 * the dangerous one.
 */
export function revocationFor(
  id: string,
  version: string,
  list: null | RevocationList,
): null | RevocationEntry {
  if (list === null) return null;
  let worst: null | RevocationEntry = null;
  for (const entry of list.revoked) {
    if (entry.id !== id) continue;
    if (!matchesRange(version, entry.versions)) continue;
    if (
      worst === null ||
      SEVERITY_RANK[entry.severity] > SEVERITY_RANK[worst.severity]
    ) {
      worst = entry;
    }
  }
  return worst;
}

/**
 * The reason to show a user: the translated `reasonKey` when there is one, else the
 * author's English prose.
 *
 * Reasons are written by hand as a malware report is being acted on, so most will never
 * have a key. `t()` returns the key itself on a miss, which is why the result is
 * compared against the key rather than trusted blindly — the same shape
 * `capabilityLabel` uses next door.
 */
export function revocationReason(
  entry: RevocationEntry,
  t: (key: string) => string,
): string {
  if (entry.reasonKey === undefined) return entry.reason;
  const translated = t(entry.reasonKey);
  return translated === entry.reasonKey ? entry.reason : translated;
}

function isRevocationEntry(value: unknown): value is RevocationEntry {
  if (value === null || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || entry.id === "") return false;
  if (typeof entry.reason !== "string") return false;
  if (!SEVERITIES.includes(entry.severity as RevocationSeverity)) return false;
  return isVersionRange(entry.versions);
}

function isVersionRange(value: unknown): value is VersionRange {
  if (value === "*") return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.entries(value).every(
    ([key, bound]) =>
      ["eq", "gt", "gte", "lt", "lte"].includes(key) &&
      typeof bound === "string",
  );
}

/**
 * The publish counter, or 0 for anything that is not a plain non-negative integer.
 *
 * ‼️ Absent and MALFORMED both read as 0, deliberately, and 0 is the weakest value there is:
 * it can never beat a stored counter and it fails the floor on a fresh install. So a document
 * that omits the field, or carries `"999"` as a string, `1e9`, `-1` or a float, loses the
 * comparison instead of winning it. Coercing a string here — `Number("999")` — would hand an
 * attacker the highest counter they can type.
 *
 * ‼️ SINCE ARMING, AN ABSENT COUNTER IS REFUSED — by the FLOOR, not here. The previous version of
 * this paragraph argued absent must stay readable "because the list that is live right now has no
 * `sequence` at all", and both halves of that are now false: the live list carries 1 and
 * `MINIMUM_REVOCATION_SEQUENCE` is 1, so a document reading as 0 loses the comparison. That is the
 * point rather than a regression — 0 is what every pre-signature list reads as, and those are
 * exactly the documents a replay would use.
 *
 * Readable-but-losing is still the right shape HERE: this function's job is to hand the weakest
 * possible value to anything it cannot trust, and the floor decides what that costs. Rejecting the
 * document outright would instead make a client keep its stored copy, which is a different and
 * worse answer for a list that is merely old.
 */
function readSequence(raw: unknown): number {
  if (
    typeof raw !== "number" ||
    !Number.isSafeInteger(raw) ||
    raw < 0 ||
    raw > MAXIMUM_REVOCATION_SEQUENCE
  ) {
    return 0;
  }
  return raw;
}
