// §260 Phase 3c-2c — the host side of `ai` for sandboxed plugins.
//
// WHY the host and not the Rust broker: the AI policy is frontend state — privacy
// mode (`useAIStore`), the per-task model/provider/baseUrl choice
// (`getConfigForTask`), and `isLLMAllowed`. A Rust `PluginOp::Ai*` would have to
// accept a model and provider FROM the sandbox, which is exactly the power a
// sandboxed plugin must not have: it could pick its own endpoint and route the
// user's prompts there, privacy mode notwithstanding.
//
// WHY a host-side check still enforces: a `plugin-*` window is granted only
// `plugin_call` + the two transport commands (capabilities/plugin-sandbox.json), so
// it cannot invoke `llm_complete`/`llm_list_models` itself. The host is the sole
// route from a sandbox to a model, which makes this check the boundary rather than a
// suggestion — the same argument that makes storage isolation real, one layer up.
import type { AIAPI, PluginCapability } from "../types";
import type { SandboxHostRequest } from "./protocol";
import type { HostRequestHandler } from "./sandbox-session";

import { createAIAPI } from "../extension-context";

export interface HostRequestHandlerOptions {
  /** Injectable for tests; defaults to the trusted tier's own AI surface. */
  aiFactory?: (pluginId: string) => AIAPI;
  /** The grants recorded at install, as the manifest declared them. */
  capabilities: readonly PluginCapability[];
  pluginId: string;
}

/**
 * Build the `HostRequestHandler` for one sandboxed plugin: capability check, then
 * the SHARED AI policy. Reusing `createAIAPI` (rather than a sandbox-specific copy)
 * is deliberate — it already carries the privacy-mode refusal, the per-task model
 * choice, and the `createLLMStream` cleanup-in-`finally` rule, and a second
 * implementation would be a second place for privacy mode to be forgotten.
 */
export function createHostRequestHandler(
  options: HostRequestHandlerOptions,
): HostRequestHandler {
  const { aiFactory = createAIAPI, capabilities, pluginId } = options;
  const granted = capabilities.includes("ai");
  // Built on first use, not up front: a plugin without the grant never gets a
  // privileged object constructed for it at all.
  let ai: AIAPI | undefined;
  const aiApi = (): AIAPI => (ai ??= aiFactory(pluginId));

  return async (request: SandboxHostRequest, onToken) => {
    if (!granted) {
      throw new Error(
        `Plugin ${pluginId} requires the "ai" capability. ` +
          `Add "ai" to the capabilities array in baram-plugin.json.`,
      );
    }
    switch (request.kind) {
      case "ai_complete":
        return aiApi().complete(request.prompt, request.opts);
      case "ai_list_models":
        return aiApi().listModels();
      case "ai_stream":
        // Resolves when the stream ends; tokens have already gone out as frames.
        await aiApi().stream(request.prompt, request.opts ?? {}, onToken);
        return undefined;
      default: {
        // A newer sandbox bundle against an older host: a clear error beats an
        // `undefined` the plugin would mistake for a result.
        const unknown: never = request;
        throw new Error(`unsupported host request: ${JSON.stringify(unknown)}`);
      }
    }
  };
}
