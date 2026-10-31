// §395 spec 0074 §5.3 · D7 · D14 · §6 — the host side of a sandboxed plugin's three file tree methods. The
// `filetree` check comes first and refuses with the trusted tier's sentence (`fileTreeCapabilityMessage`,
// plan 0127 P24); everything after it is the tier-neutral host's (`file-decorations/decoration-host.ts`),
// which judges, paces and applies. What only this tier has is the path: relative to a context root,
// resolved here to an absolute path when the request arrives — a left-out `context` is the context the
// app shows at that moment (D7, read from `useContextStore`, which can differ from the backend's active
// context that `ctx.files` reads without a context).
// Unlike the trusted tier, this one needs no released switch: `SandboxSession.dispose` sets `disposed` and
// calls `offMessage()`, so `onHostRequest` returns early, and it runs before `unregisterPluginUI` ->
// `releaseFileTree` on unload — in the same synchronous span on rollback (no `await` between them in
// `plugin-loader`). Inserting an await there would reopen the hole `decoration-host` closed for trusted.
import type { PluginCapability } from "../types";
import type { FileTreeRequest } from "./protocol";

import { useContextStore } from "../../stores/context/context";
import {
  clearFileDecorationsFor,
  defineFileIconFor,
  setFileDecorationsFor,
} from "../file-decorations/decoration-host";
import {
  fileTreeCapabilityMessage,
  NO_ACTIVE_CONTEXT_MESSAGE,
  relativeLocate,
  UNKNOWN_CONTEXT_MESSAGE,
} from "../file-decorations/validate";
import { absoluteInContext } from "../locate-in-context";
import { pluginSourceLabel } from "../plugin-text";

export interface FileTreeRequestHandlerOptions {
  /** The context a `context`-less update resolves against. The app's active context by default. */
  activeContextId?: () => null | string;
  /** Grants recorded at install, as the manifest declared them. */
  capabilities: readonly PluginCapability[];
  pluginId: string;
  /** Display name for the row's hover text; falls back to the id (`pluginSourceLabel`). */
  pluginName?: string;
}

export function createFileTreeRequestHandler(
  options: FileTreeRequestHandlerOptions,
): (request: FileTreeRequest) => Promise<unknown> {
  const {
    activeContextId = () => useContextStore.getState().activeContextId,
    capabilities,
    pluginId,
    pluginName,
  } = options;
  const label = pluginSourceLabel(pluginName, pluginId);
  const held = capabilities.includes("filetree");
  const gate = (
    method: Parameters<typeof fileTreeCapabilityMessage>[0],
  ): void => {
    if (!held) throw new Error(fileTreeCapabilityMessage(method));
  };
  return async (request: FileTreeRequest) => {
    switch (request.kind) {
      case "filetree_clear_decorations":
        gate("clearFileDecorations");
        return clearFileDecorationsFor(pluginId);
      case "filetree_define_icon":
        gate("defineFileIcon");
        return defineFileIconFor(pluginId, request.name, request.svg);
      case "filetree_set_decorations": {
        gate("setFileDecorations");
        // D7 — read once, when the request arrives: a call that waits in line keeps this context.
        const active = activeContextId();
        return setFileDecorationsFor(
          pluginId,
          label,
          request.updates,
          (item) => {
            const shape = relativeLocate(item);
            if (typeof shape === "string") return shape;
            const contextId = shape.context ?? active;
            if (contextId === null) return NO_ACTIVE_CONTEXT_MESSAGE;
            const absolute = absoluteInContext(contextId, shape.path);
            return absolute === null ? UNKNOWN_CONTEXT_MESSAGE : { absolute };
          },
        );
      }
      default: {
        const unknown: never = request;
        throw new Error(
          `unsupported file tree request: ${JSON.stringify(unknown)}`,
        );
      }
    }
  };
}
