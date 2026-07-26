// §260 Sandbox bootstrap — runs inside a hidden plugin WebviewWindow. Wires the
// client to the per-webview IPC-channel transport (Phase 3c-2a: this window holds
// no Tauri event permission, so host↔sandbox messages ride on commands plus an
// `ipc::Channel`). Plugin ESM is imported HERE (the isolation boundary).
import { pluginCall } from "../ipc/plugin-invoke";
import { startSandboxClient } from "../plugins/sandbox/sandbox-client";
import { createSandboxTransport } from "../plugins/sandbox/tauri-sandbox-transport";
import { logger } from "../utils/logger";

// An async bootstrap rather than top-level await, so the entry does not depend on
// the build target's TLA support.
void (async () => {
  try {
    const transport = await createSandboxTransport();
    startSandboxClient(
      transport,
      (url) => import(/* @vite-ignore */ url),
      (op) => pluginCall(op),
    );
  } catch (err) {
    // Nothing else can be done from in here: with no transport there is no way to
    // report failure to the host, which will surface an activate timeout instead.
    logger.error("[Sandbox] transport bootstrap failed:", err);
  }
})();
