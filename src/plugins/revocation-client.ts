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
import {
  meetsRevocationFloor,
  normalizeRevocationList,
  revocationFloorFor,
} from "./revocation";

/**
 * How long startup will wait for a fresher list before loading installed plugins.
 *
 * Not zero, because a fire-and-forget refresh loses the race to a local `asset://`
 * import essentially always, and one won race is enough for a `trusted` plugin to
 * disarm revocation permanently. Not unbounded, because the stored list already
 * governs the gate — waiting longer buys freshness, never protection, and an offline
 * user would pay a full network timeout on every launch.
 */
export const REVOCATION_REFRESH_BUDGET_MS = 1500;

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
    const fetched = await pluginFetchRevocations(url);
    const parsed = normalizeRevocationList(safeParse(fetched.body));
    if (parsed === null) {
      // A reachable host serving an unreadable document must not clear protection.
      // A botched deploy is the likely cause and it would otherwise disarm every
      // client silently. An empty-but-well-formed list IS accepted — withdrawing a
      // revocation has to work.
      logger.warn("[Revocation] unreadable list, keeping the stored one");
      return;
    }
    // ‼️ EVERY READ OF THE STORE IS RE-READ HERE, AFTER THE AWAIT (code review HIGH-1). The
    // snapshot taken before the fetch is stale by the time it lands: `plugin-lifecycle.ts`
    // races this against a 1500 ms budget and the abandoned promise keeps running, so a slow
    // network followed by the marketplace mounting had two refreshes comparing against
    // pre-await state. A sequence-1 rollback overwrote a stored sequence 2 that way, and on a
    // fresh install the abandoned snapshot still said `revocations: null`.
    const current = usePluginStore.getState();
    // ‼️ THE COUNTER IS ONLY BELIEVED WHEN RUST SAYS IT CHECKED THE BYTES — and be precise
    // about which attacker that stops, because the first version of this comment claimed one it
    // does not.
    //
    // It stops a NETWORK attacker: someone serving the origin cannot move the mark while
    // enforcement is unarmed, and once armed cannot move it without a real signature. That is
    // worth having, and it is the whole of what this flag buys.
    //
    // It does NOT stop the in-realm attacker `plugin-lifecycle.ts` models. A `trusted` plugin
    // patching `window.__TAURI_INTERNALS__.invoke` writes the WHOLE answer, `verified`
    // included — so treating the flag as authentication was a mistake: it is one more field
    // that attacker controls. Nothing crossing this boundary can authenticate the answer, and
    // moving the decision into Rust would not help either, because `capabilities/default.json`
    // grants the `main` realm `allow-set-config` and `allow-export-binary-file`. The trusted
    // tier is full trust by §260's design; the containment is the install-time consent gate,
    // not this function.
    //
    // What IS refused is a DURABLE poison: the mark is no longer persisted, so an in-realm
    // attacker's counter dies with the session instead of refusing every genuine list forever.
    // See the `partialize` block in `stores/system/plugin.ts`.
    //
    // While signing is unarmed there is therefore no counter protection against the network
    // either. That is the honest shape — signature and counter are a pair, and a pair arms
    // together.
    if (!fetched.verified) {
      logger.warn(
        "[Revocation] list was NOT signature-verified — storing it, but its sequence is",
        "not trusted and will not raise the floor",
      );
      current.setRevocations(parsed, false);
      return;
    }
    // A verified list may still not move the counter BACKWARDS. The empty list was live for 31
    // hours before the first revocation was recorded, so that empty document carries a
    // permanently valid signature — replaying it is how every revocation gets cleared without
    // forging anything. Refusing a lower counter is the half a signature cannot do.
    const floor = revocationFloorFor(
      current.revocationSequenceSeen,
      current.registryUrl,
    );
    if (!meetsRevocationFloor(parsed, floor)) {
      logger.error(
        "[Revocation] REFUSED a list older than this registry has already reached — sequence",
        parsed.sequence,
        "<",
        floor,
        "— this is a rollback, not a stale cache",
      );
      return;
    }
    current.setRevocations(parsed, true);
  } catch (err) {
    // Offline is expected and unremarkable. An ACL denial or an HTTP error is not — it
    // means the feature is structurally broken, and logging both at the same level is
    // how the missing `plugin_fetch_revocations` ACL grant hid for a whole review
    // cycle: every client failed every refresh and it read exactly like a plane.
    const message = String(err);
    // ‼️ SIGNATURE AND KEY FAILURES BELONG IN THE LOUD BRANCH (code review HIGH-2). Once
    // enforcement is armed, a mangled `REVOCATION_PUBLIC_KEY` — a truncated paste, the private
    // half, a stray newline — makes every fetch fail with "revocation public key is not
    // base64", which the pattern below does not match. It was therefore logged as "refresh
    // failed, keeping the stored list": indistinguishable from being offline, on every client,
    // forever, with the only user-visible signal the marketplace staleness banner 30 days
    // later. The arming step is a one-line paste, so this is the failure to make audible.
    if (
      /not allowed|forbidden|denied|HTTP \d|signature|public key|unsigned|too large|not UTF-8/iu.test(
        message,
      )
    ) {
      logger.error(
        "[Revocation] refresh is FAILING STRUCTURALLY, not merely offline:",
        err,
      );
    } else {
      logger.warn("[Revocation] refresh failed, keeping the stored list:", err);
    }
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
    // Caller treats null as "unreadable" and keeps the stored list. What no client-side check
    // can tell apart is a host deliberately serving a VALID empty list — that is closed by the
    // signature (Rust reports `verified`) plus the counter above, and only once
    // `REVOCATION_PUBLIC_KEY` is filled in. Until then neither half applies.
    logger.warn("[Revocation] list is not JSON");
    return null;
  }
}
