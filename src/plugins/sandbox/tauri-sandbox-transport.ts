import { Channel } from "@tauri-apps/api/core";

// §260 Phase 3c-2a — the SANDBOX end of the transport, running inside the hidden
// plugin WebviewWindow. A `plugin-*` window holds NO `core:event:*` permission
// (Tauri delivers broadcast events to any `EventTarget::Any` listener, which no
// emitter-side filter can prevent), so inbound messages arrive on an IPC channel
// handed to Rust at boot — point-to-point to this webview — and outbound goes
// through `plugin_sandbox_report`, which stamps the plugin id from the window
// label. This file plus `plugin_call` is the sandbox's entire IPC surface.
import type { HostToSandbox, SandboxToHost } from "./protocol";
import type { SandboxTransport } from "./transport";

import {
  pluginSandboxConnect,
  pluginSandboxReport,
} from "../../ipc/plugin-invoke";
import { logger } from "../../utils/logger";

export async function createSandboxTransport(): Promise<
  SandboxTransport<HostToSandbox, SandboxToHost>
> {
  const handlers = new Set<(m: HostToSandbox) => void>();
  let closed = false;
  const channel = new Channel<HostToSandbox>();
  // Wire the handler set BEFORE connecting, so a message the host sends the
  // instant registration lands cannot arrive with nowhere to go.
  channel.onmessage = (msg) => {
    if (!closed) handlers.forEach((h) => h(msg));
  };
  await pluginSandboxConnect(channel);
  return {
    close: () => {
      closed = true;
      handlers.clear();
    },
    onMessage: (h) => {
      handlers.add(h);
      return () => handlers.delete(h);
    },
    // Fire-and-forget: a rejected report (host gone, plugin deregistered) must
    // not surface as an unhandled rejection inside plugin code.
    send: (msg) => {
      void pluginSandboxReport(msg).catch((err: unknown) => {
        logger.debug("[Sandbox] report failed:", err);
      });
    },
  };
}
