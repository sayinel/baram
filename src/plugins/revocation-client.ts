// §69 fetching the revocation list. The decisions live in `revocation.ts`; this file
// is only the IO around them.
//
// Kept separate from `registry-client.ts` because the two have deliberately DIFFERENT
// staleness rules, and putting them in one file would invite someone to unify them.
// The browse index may be arbitrarily stale — an old catalogue is harmless. A stale
// revocation list is not: it is the difference between a revoked plugin being stopped
// and being run.

import { pluginFetchRevocations } from "../ipc/plugin-invoke";
import { usePluginStore } from "../stores/system/plugin";
import { logger } from "../utils/logger";
import { normalizeRevocationList } from "./revocation";

/**
 * How old a stored list may get before the UI says so.
 *
 * It does NOT gate anything. A user offline for a month keeps the protection they
 * already have; they are simply told the list is old. Blocking on freshness would turn
 * a network outage into a plugin outage, which no local-first editor should do.
 */
export const REVOCATION_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Fetch the list and store it. Failure is logged and swallowed.
 *
 * Swallowing is the point. This runs on a background path; the stored list keeps
 * applying regardless, and a fetch that failed must never be the reason a plugin does
 * or does not load. The only thing a failure costs is freshness.
 */
export async function refreshRevocations(): Promise<void> {
  const store = usePluginStore.getState();
  const url = revocationUrlFor(store.registryUrl);
  if (url === null) {
    logger.warn("[Revocation] registry URL is not a URL:", store.registryUrl);
    return;
  }
  try {
    const text = await pluginFetchRevocations(url);
    const parsed = normalizeRevocationList(safeParse(text));
    if (parsed === null) {
      // A reachable host serving an unreadable document must not clear protection.
      // A botched deploy is the likely cause and it would otherwise disarm every
      // client silently. An empty-but-well-formed list IS accepted — withdrawing a
      // revocation has to work.
      logger.warn("[Revocation] unreadable list, keeping the stored one");
      return;
    }
    store.setRevocations(parsed);
  } catch (err) {
    // Expected offline. The stored list is unaffected.
    logger.warn("[Revocation] refresh failed, keeping the stored list:", err);
  }
}

/** Whether the stored list is old enough to tell the user about. */
export function revocationsAreStale(fetchedAt: number, now: number): boolean {
  // Never fetched is not "stale" — it is "no protection yet", which the UI words
  // differently. Treating 0 as stale would show an alarming age on first run.
  if (fetchedAt === 0) return false;
  return now - fetchedAt > REVOCATION_STALE_AFTER_MS;
}

/**
 * The revocation list URL for a given registry, resolved as a sibling of the index.
 *
 * Resolved with the URL parser rather than by string surgery so that a custom registry
 * gets its OWN revocation list. A user pointing at their own index must not silently
 * keep enforcing ours.
 */
export function revocationUrlFor(registryUrl: string): null | string {
  try {
    return new URL("revoked.json", registryUrl).toString();
  } catch {
    return null;
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Caller treats null as "unreadable" and keeps the stored list. What no
    // client-side check can tell apart is a host deliberately serving a VALID empty
    // list; signing the list is what closes that, and it is the next step in the spec.
    logger.warn("[Revocation] list is not JSON");
    return null;
  }
}
