import { listen } from "@tauri-apps/api/event";

// §260 Phase 3c-2a — the HOST end of the sandbox transport. Outbound goes over
// the host-only `plugin_sandbox_send` command, which Rust delivers on the target
// sandbox's own IPC channel; inbound is the `plugin:s2h` event Rust re-emits with
// the reporting plugin's id stamped from its window label, so this end filters by
// id rather than trusting a channel name. Thin adapter — the machinery is tested
// against the in-memory pair; this file is covered by its own unit test.
import type { HostToSandbox, SandboxToHost } from "./protocol";
import type { SandboxTransport } from "./transport";

import { pluginSandboxSend } from "../../ipc/plugin-invoke";
import { logger } from "../../utils/logger";

/** What Rust puts on `plugin:s2h` (see `plugin_sandbox_report`). */
interface S2HEnvelope {
  msg: SandboxToHost;
  pluginId: string;
}

export async function createHostTransport(
  pluginId: string,
): Promise<SandboxTransport<SandboxToHost, HostToSandbox>> {
  const handlers = new Set<(m: SandboxToHost) => void>();
  let closed = false;
  const unlisten = await listen<S2HEnvelope>("plugin:s2h", (event) => {
    if (closed) return;
    const envelope = event.payload;
    if (typeof envelope !== "object" || envelope === null) return;
    if (envelope.pluginId !== pluginId) return; // another sandbox's report
    if (!isWellFormed(envelope.msg)) {
      logger.debug(`[Sandbox] dropped malformed s2h frame from ${pluginId}`);
      return;
    }
    handlers.forEach((h) => h(envelope.msg));
  });
  return {
    close: () => {
      closed = true;
      // `unlisten()` invokes `plugin:event|unlisten`, so it really can reject
      // during window/app teardown — but Tauri types `UnlistenFn` as `() => void`
      // while the implementation returns a promise, so wrap before catching or the
      // rejection is unhandled (and `.catch` does not typecheck).
      void Promise.resolve(unlisten() as unknown).catch(() => {});
      handlers.clear();
    },
    onMessage: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    // Fire-and-forget: `plugin_sandbox_send` rejects until the sandbox has called
    // `plugin_sandbox_connect`, which is the normal state during the session's
    // activate retry window. Log, never reject into the caller.
    send: (msg) => {
      void pluginSandboxSend(pluginId, msg).catch((err: unknown) => {
        logger.debug(`[Sandbox] send to ${pluginId} failed:`, err);
      });
    },
  };
}

/**
 * §260 3c-2a review (M1) — `msg` is fully attacker-controlled: Rust forwards an
 * unvalidated `serde_json::Value`, so the sandbox picks the shape. Validate the
 * discriminant AND the fields each branch of `SandboxSession.handle` dereferences,
 * or e.g. `{type:"ready",registered:null}` reaches `report.commands` and throws out
 * of this listener. Unknown shapes are dropped, not repaired.
 */
function isWellFormed(msg: unknown): msg is SandboxToHost {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  switch (m.type) {
    case "activateError":
      return typeof m.error === "string";
    case "callResult":
      return (
        typeof m.callId === "string" &&
        (m.ok === true || (m.ok === false && typeof m.error === "string"))
      );
    case "emitEvent":
      return typeof m.event === "string" && Array.isArray(m.args);
    case "ready": {
      const r = m.registered as null | Record<string, unknown> | undefined;
      return (
        typeof r === "object" &&
        r !== null &&
        Array.isArray(r.commands) &&
        Array.isArray(r.events)
      );
    }
    default:
      return false;
  }
}
