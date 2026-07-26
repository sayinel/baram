// §260 Phase 4a — routes one sandboxed plugin's host-mediated requests to the bridge
// that owns each service. Split from the bridges themselves because 3c-2c's single
// handler put ONE capability check (`ai`) ahead of the switch: adding a second service
// there would have made `ui` require the `ai` grant. Each bridge now owns its own gate,
// and this file owns only the routing.

import type { HostRequestHandlerOptions } from "./host-ai-bridge";
import type { UIRequestHandlerOptions } from "./host-ui-bridge";
import type { SandboxHostRequest } from "./protocol";
import type { HostRequestHandler } from "./sandbox-session";

import { createAIRequestHandler } from "./host-ai-bridge";
import { createUIRequestHandler } from "./host-ui-bridge";

export type HostServicesOptions = HostRequestHandlerOptions &
  Omit<UIRequestHandlerOptions, "capabilities" | "pluginId">;

/**
 * The `HostRequestHandler` for one sandboxed plugin.
 *
 * The `default` branch's `never` assignment is load-bearing: it makes `tsc` fail when
 * `SandboxHostRequest` gains a member that nothing routes, which is the compile-time
 * half of the lesson from 3c-2c F1 (`hostRequest` shipped dead because a runtime
 * allowlist was missed). The other half lives in `tauri-host-transport`'s validator
 * record — a request type needs BOTH to actually work.
 */
export function createHostRequestHandler(
  options: HostServicesOptions,
): HostRequestHandler {
  const ai = createAIRequestHandler(options);
  const ui = createUIRequestHandler(options);
  return async (request: SandboxHostRequest, onToken) => {
    switch (request.kind) {
      case "ai_complete":
      case "ai_list_models":
      case "ai_stream":
        return ai(request, onToken);
      case "ui_notify":
      case "ui_status_bar":
        return ui(request);
      default: {
        // A newer sandbox bundle against an older host: a clear error beats an
        // `undefined` the plugin would mistake for a result.
        const unknown: never = request;
        throw new Error(`unsupported host request: ${JSON.stringify(unknown)}`);
      }
    }
  };
}
