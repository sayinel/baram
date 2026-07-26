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
    // Defensive: this event is app-internal, but a malformed payload must never
    // throw inside the Tauri listener (it would kill later deliveries).
    if (typeof envelope !== "object" || envelope === null) return;
    if (envelope.pluginId !== pluginId) return; // another sandbox's report
    if (typeof envelope.msg !== "object" || envelope.msg === null) return;
    handlers.forEach((h) => h(envelope.msg));
  });
  return {
    close: () => {
      closed = true;
      unlisten();
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
