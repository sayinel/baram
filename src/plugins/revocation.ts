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
  /** ISO date, display only. */
  since?: string;
  versions: VersionRange;
}

export interface RevocationList {
  revoked: RevocationEntry[];
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
export const EMPTY_REVOCATIONS: RevocationList = { revoked: [], version: 1 };

/** Whether this revocation stops the plugin from running at all. */
export function blocksLoad(entry: null | RevocationEntry): boolean {
  return entry?.severity === "malicious";
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
  const doc = raw as { revoked?: unknown; version?: unknown };
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
  return { revoked, version: 1 };
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
