// §260 Sandbox bootstrap — runs inside a hidden plugin WebviewWindow. Wires the
// client to the per-webview IPC-channel transport (Phase 3c-2a: this window holds
// no Tauri event permission, so host↔sandbox messages ride on commands plus an
// `ipc::Channel`). Plugin ESM is imported HERE (the isolation boundary).
import { pluginCall } from "../ipc/plugin-invoke";
import { startSandboxClient } from "../plugins/sandbox/sandbox-client";
import { createSandboxTransport } from "../plugins/sandbox/tauri-sandbox-transport";
import { logger } from "../utils/logger";

/**
 * §260 3c-2b — run the plugin's own bundle from a `blob:` URL. This is why the
 * sandbox CSP can drop `asset:`: a blob is built from bytes this realm was handed,
 * so it grants no file access, whereas `asset:` would let the plugin read anything
 * in Tauri's app-global asset scope (other plugins, the vault).
 *
 * The URL is revoked in a `finally` — the module keeps running once evaluated, and
 * a long-lived sandbox must not accumulate blob URLs. A blob module has no base URL,
 * so the bundle must be self-contained (enforced at validation).
 */
async function importFromBlob(
  source: string,
): Promise<Record<string, unknown>> {
  const url = URL.createObjectURL(
    new Blob([source], { type: "text/javascript" }),
  );
  try {
    return (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// An async bootstrap rather than top-level await, so the entry does not depend on
// the build target's TLA support.
void (async () => {
  try {
    const transport = await createSandboxTransport();
    startSandboxClient(transport, importFromBlob, (op) => pluginCall(op));
  } catch (err) {
    // Nothing else can be done from in here: with no transport there is no way to
    // report failure to the host, which will surface an activate timeout instead.
    logger.error("[Sandbox] transport bootstrap failed:", err);
  }
})();
