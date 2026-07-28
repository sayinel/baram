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

import { pluginSandboxStage } from "../../ipc/plugin-invoke";
import { createAIAPI } from "../extension-context";

/**
 * The trusted tier's own AI factory, named so a test can pin the identity rather
 * than merely that a default exists (§260 3c-2c code review). Sharing it is the
 * point: one implementation of privacy mode and model selection for both tiers.
 */
export const DEFAULT_AI_FACTORY = createAIAPI;

export interface HostRequestHandlerOptions {
  /** Injectable for tests; defaults to `DEFAULT_AI_FACTORY`. */
  aiFactory?: (pluginId: string) => AIAPI;
  /** The grants recorded at install, as the manifest declared them. */
  capabilities: readonly PluginCapability[];
  pluginId: string;
  /** Injectable for tests; defaults to the host-only staging command (§260 Phase 4c). */
  stage?: (pluginId: string, payload: string) => Promise<void>;
}

/** The `ai_*` members of `SandboxHostRequest` — what this bridge answers. */
type AIRequest = Extract<SandboxHostRequest, { kind: `ai_${string}` }>;

/**
 * Build the `ai` half of one sandboxed plugin's host-request handler: capability check,
 * then the SHARED AI policy. Reusing `createAIAPI` (rather than a sandbox-specific copy)
 * is deliberate — it already carries the privacy-mode refusal, the per-task model
 * choice, and the `createLLMStream` cleanup-in-`finally` rule, and a second
 * implementation would be a second place for privacy mode to be forgotten.
 *
 * Answers only `ai_*` kinds (§260 Phase 4a): this used to be the whole handler, with the
 * `ai` check ahead of the switch, so a second service added there would have inherited
 * the `ai` requirement. Routing now lives in `host-request-router`.
 */
export function createAIRequestHandler(
  options: HostRequestHandlerOptions,
): (request: AIRequest, onToken: (token: string) => void) => Promise<unknown> {
  const {
    aiFactory = DEFAULT_AI_FACTORY,
    capabilities,
    pluginId,
    stage = pluginSandboxStage,
  } = options;
  const granted = capabilities.includes("ai");
  // Built on first use, not up front: a plugin without the grant never gets a
  // privileged object constructed for it at all.
  let ai: AIAPI | undefined;
  const aiApi = (): AIAPI => (ai ??= aiFactory(pluginId));

  return async (request: AIRequest, onToken) => {
    if (!granted) {
      throw new Error(
        `Plugin ${pluginId} requires the "ai" capability. ` +
          `Add "ai" to the capabilities array in baram-plugin.json.`,
      );
    }
    switch (request.kind) {
      case "ai_complete":
        // §260 Phase 4c — STREAMED, even though the plugin asked for one string.
        //
        // The gap 4b deferred: an inline answer over 8 KiB enters tauri's app-global
        // channel-data queue, which is ACL-exempt and keyed by a guessable sequential id
        // (see `editor_get_markdown`). A completion routinely exceeds that, and the natural
        // use of `ai` in this tier is "read the document, summarise it" — so it can carry
        // document-derived text into the queue that staging the document just closed.
        //
        // Streaming rather than staging, unlike the document, because `complete` is
        // implemented as "stream and accumulate the buffer" ONE LAYER DOWN already
        // (`createAIAPI`), so this changes no policy and adds no state — and because a
        // staged answer would hold the sandbox's single staged slot for the whole length of
        // an LLM call, serialising every document read behind it. Each token rides its own
        // small `hostStreamToken` frame; the client accumulates and returns the string, so
        // `ctx.ai.complete` is unchanged for the plugin. It also inherits the stall timer's
        // per-token restart, which an inline `complete` never had.
        await aiApi().stream(request.prompt, request.opts ?? {}, onToken);
        return undefined;
      case "ai_list_models": {
        // Staged, for the reason the response frame cannot carry it: a model list is a JSON
        // ARRAY, so it satisfies the queue's `[` condition the moment a user's Ollama
        // install pushes it past 8 KiB. Cheap to serialise here and rarely called, so
        // holding the staged slot for it costs nothing.
        const models = await aiApi().listModels();
        await stage(pluginId, JSON.stringify(models));
        return undefined;
      }
      case "ai_stream":
        // Resolves when the stream ends; tokens have already gone out as frames.
        await aiApi().stream(request.prompt, request.opts ?? {}, onToken);
        return undefined;
      default: {
        // A newer sandbox bundle against an older host: a clear error beats an
        // `undefined` the plugin would mistake for a result.
        const unknown: never = request;
        throw new Error(`unsupported ai request: ${JSON.stringify(unknown)}`);
      }
    }
  };
}
