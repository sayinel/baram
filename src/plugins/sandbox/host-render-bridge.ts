// §394 spec 0073 D13 · plan 0125 P11 — the host side of a sandboxed plugin's `render_*` requests:
// stage a waiting render's source for the sandbox to pull, and apply `invalidate`. Gated on
// `codeblocks` like every bridge on its service's grant.

import type { PluginCapability } from "../types";
import type { SandboxHostRequest } from "./protocol";

import { pluginSandboxStage } from "../../ipc/plugin-invoke";
import { createRequiredCapabilityGate } from "./capability-gate";

export interface RenderRequestHandlerOptions {
  capabilities: readonly PluginCapability[];
  /** `ctx.codeBlocks.invalidate` for this plugin, by the code-blocks API's rule. Absent: nothing to invalidate. */
  invalidate?: (lang?: string) => void;
  pluginId: string;
  /** The source of a waiting render — `SandboxSession.renderSource`. Absent: no render waits. */
  renderSource?: (id: string) => string | undefined;
  /** Injectable for tests; defaults to the host-only staging command. */
  stage?: (pluginId: string, payload: string) => Promise<void>;
}

type RenderRequest = Extract<SandboxHostRequest, { kind: `render_${string}` }>;

export function createRenderRequestHandler(
  options: RenderRequestHandlerOptions,
): (request: RenderRequest) => Promise<unknown> {
  const {
    capabilities,
    invalidate = () => {},
    pluginId,
    renderSource = () => undefined,
    stage = pluginSandboxStage,
  } = options;
  const requireCodeBlocks = createRequiredCapabilityGate(
    pluginId,
    capabilities,
    "codeblocks",
  );
  return async (request) => {
    requireCodeBlocks();
    switch (request.kind) {
      case "render_get_source": {
        const source = renderSource(request.id);
        if (source === undefined) {
          throw new Error(
            `no render "${request.id}" is waiting for its source`,
          );
        }
        // Staged, never answered inline (`plugin/staging.rs`): AWAITED before the answer, which is
        // what tells the sandbox to pull.
        await stage(pluginId, source);
        return undefined;
      }
      case "render_invalidate":
        invalidate(request.lang);
        return undefined;
    }
  };
}
