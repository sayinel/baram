// §260 Phase 4a — the host side of `events` for sandboxed plugins.
//
// The trusted tier hears app events through `emitPluginEvent`, which calls handlers
// registered in this realm. A sandbox has no handler here: its `events.on` lives in the
// other realm, reachable only through `SandboxSession.deliverEvent`. This module is the
// piece that was missing — `deliverEvent` existed since Phase 2 and nothing called it,
// which is why a sandboxed plugin could not learn a path (§260 3c-3 finding).
//
// Two things happen on the way across, and both are the reason this is not a plain
// forward:
//   1. the `events` capability is checked — a plugin without it gets no frames at all;
//   2. an absolute path becomes `{context, path}` with a VAULT-RELATIVE path, or the
//      event is dropped. No absolute path crosses the boundary, which is what keeps the
//      user's home directory out of the tier (see `SandboxFilesAPI`).
import type {
  PluginCapability,
  PluginEventName,
  PluginFileEvent,
} from "../types";
import type { SandboxSession } from "./sandbox-session";

import { logger } from "../../utils/logger";

/**
 * Every app event a sandboxed plugin may receive, and how its payload crosses.
 *
 * ‼️ A discriminant-keyed RECORD, not a set of "these ones carry a path" (§260 Phase 4a
 * security review, MEDIUM-4). As a set, translation was opt-IN per event: adding
 * `file:rename`/`file:delete` later would have forwarded its absolute path to the sandbox
 * silently, because the `else` branch passes `args` through untouched. This form makes
 * `tsc` refuse a new `PluginEventName` until someone declares which it is — the same
 * shape as the frame-validator record, and for the same reason, except that omission
 * failed CLOSED (a dead feature) while this one would fail OPEN (a leaked path).
 *
 * - `"path"` — `args[0]` is an absolute path; translate it or drop the event.
 * - `"none"` — no payload to translate; forwarded as-is.
 */
const EVENT_PAYLOADS: Record<PluginEventName, "none" | "path"> = {
  "editor:ready": "none",
  "file:open": "path",
  "file:save": "path",
};

/**
 * Resolves an absolute file path to the context that contains it. Injected so tests
 * need no store, and so the bridge does not care whether the answer comes from the
 * context store or somewhere else later.
 */
export type ContextResolver = (absolutePath: string) => null | PluginFileEvent;

/** One registered sandbox, as this bridge needs to see it. */
interface Subscriber {
  capabilities: readonly PluginCapability[];
  pluginId: string;
  session: Pick<SandboxSession, "deliverEvent">;
}

const subscribers = new Map<string, Subscriber>();
let resolveContext: ContextResolver = () => null;

/**
 * Deliver one app event to every sandbox that may hear it.
 *
 * Path-bearing events are translated per subscriber-independent rules, so the work
 * happens once; a plugin without `events` is skipped without the payload ever being
 * built for it.
 */
export function deliverSandboxEvent(
  event: PluginEventName,
  args: unknown[],
): void {
  if (subscribers.size === 0) return;
  // An event this module has no rule for is DROPPED, not guessed at: `event` arrives from
  // a plain string call site, so the type alone cannot be the whole guard.
  const kind = Object.hasOwn(EVENT_PAYLOADS, event)
    ? EVENT_PAYLOADS[event]
    : undefined;
  if (kind === undefined) {
    logger.debug(`[Sandbox] no delivery rule for event "${event}" — dropped`);
    return;
  }
  let payload: unknown[];
  if (kind === "path") {
    const absolute = args[0];
    if (typeof absolute !== "string") return;
    const located = resolveContext(absolute);
    if (!located) {
      // §89 single-file mode, or a file in no registered context. Dropped rather than
      // degraded to an absolute path: the whole point of the translation is that this
      // tier never sees one, and "no event" is the honest answer to "which vault-relative
      // path is this?" when there is none.
      logger.debug(
        `[Sandbox] ${event} not delivered — the file is outside every context`,
      );
      return;
    }
    payload = [located];
  } else {
    payload = args;
  }
  for (const { capabilities, session } of subscribers.values()) {
    if (!capabilities.includes("events")) continue;
    session.deliverEvent(event, payload);
  }
}

/**
 * Deliver the app's CURRENT state to one just-activated sandbox, as if the user had
 * acted now.
 *
 * Without this a plugin that loads while a file is already open — the normal case at
 * startup — hears nothing until the next tab switch, so its first useful moment depends
 * on the user doing something. Delivered only to this session, and only if the file
 * resolves to a context.
 */
export function replayCurrentState(
  subscriber: Subscriber,
  currentFile: null | string,
): void {
  if (!subscriber.capabilities.includes("events") || !currentFile) return;
  const located = resolveContext(currentFile);
  if (!located) return;
  subscriber.session.deliverEvent("file:open", [located]);
}

/** Test seam: drop all subscribers and the resolver. */
export function resetSandboxEventBridge(): void {
  subscribers.clear();
  resolveContext = () => null;
}

/**
 * Point the bridge at the app's context state. Called once at startup; the loader does
 * not need to know how a path becomes a context.
 */
export function setContextResolver(resolver: ContextResolver): void {
  resolveContext = resolver;
}

/** Register a live sandbox session to receive app events. Returns an unsubscriber. */
export function subscribeSandbox(subscriber: Subscriber): () => void {
  subscribers.set(subscriber.pluginId, subscriber);
  return () => {
    // Identity check for the same reason the loader's maps have one: a stale unsubscribe
    // from a previous load must not remove the session that replaced it.
    if (subscribers.get(subscriber.pluginId) === subscriber) {
      subscribers.delete(subscriber.pluginId);
    }
  };
}
