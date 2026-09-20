// §260 Phase 4c — the host side of `settings` for sandboxed plugins.
//
// WHY the host: the values are the USER's, kept in the app's own persisted store, and the
// declared fields come from the manifest the install dialog showed. Neither lives in the
// sandbox realm, and neither may be supplied by it — a plugin that could name its own
// fields could read any key in the record.
//
// WHY it is a read and a NOTIFICATION, and nothing else: a setting is the user's answer to
// a question the plugin asked. A plugin that could write one could silently undo a choice
// the user made — turn a "send this document to my server" toggle back on — with no UI
// anywhere showing that it moved. Mutable plugin-owned state is what `storage` is for.
//
// The CHANGE NOTIFICATION that used to live here moved to `../settings-change-notifier` in
// §0054: the trusted tier needs the same event, the same debounce and the same capability
// rule, and keeping them under `sandbox/` is what let the trusted tier go without.
import type { PluginCapability, PluginSettingField } from "../types";
import type { SandboxHostRequest } from "./protocol";

import { pluginSandboxStage } from "../../ipc/plugin-invoke";
import { usePluginStore } from "../../stores/system/plugin";
import { resolvePluginSettings } from "../plugin-settings";
import { createRequiredCapabilityGate } from "./capability-gate";

export interface SettingsRequestHandlerOptions {
  capabilities: readonly PluginCapability[];
  /**
   * The fields this plugin DECLARED, resolved by the host (`declaredSettingsFor`). They
   * travel with the handler for the same reason the status bar's ids do: the host, not the
   * plugin, decides which fields exist.
   */
  declaredSettings: readonly PluginSettingField[];
  /** Injectable for tests; defaults to the live persisted record. */
  persisted?: () => Record<string, unknown> | undefined;
  pluginId: string;
  /** Injectable for tests; defaults to the host-only staging command. */
  stage?: (pluginId: string, payload: string) => Promise<void>;
}

type SettingsRequest = Extract<
  SandboxHostRequest,
  { kind: `settings_${string}` }
>;

/**
 * Build the `settings` half of one sandboxed plugin's host-request handler.
 *
 * The answer is STAGED, never returned in the response frame — see the `settings_read`
 * member of `SandboxHostRequest` for the threshold argument. Awaited before the handler
 * resolves, because resolving is what tells the sandbox to pull.
 */
export function createSettingsRequestHandler(
  options: SettingsRequestHandlerOptions,
): (request: SettingsRequest) => Promise<unknown> {
  const {
    capabilities,
    declaredSettings,
    // `options.pluginId`, not the destructured `pluginId`: `perfectionist` sorts these keys,
    // so `persisted` is bound BEFORE it and a default reading the binding would hit its TDZ.
    persisted = () => livePersisted(options.pluginId),
    pluginId,
    stage = pluginSandboxStage,
  } = options;
  const requireSettings = createRequiredCapabilityGate(
    pluginId,
    capabilities,
    "settings",
  );

  return async (request: SettingsRequest) => {
    switch (request.kind) {
      case "settings_read": {
        requireSettings();
        // Resolved against the manifest EVERY time, not cached: the user can change a value
        // while the plugin runs, and the resolver is what keeps a persisted value that no
        // longer matches its field from reaching plugin code.
        const values = resolvePluginSettings(declaredSettings, persisted());
        await stage(pluginId, JSON.stringify(values));
        return undefined;
      }
      default: {
        // ‼️ No `const unknown: never = request` here, unlike the other bridges. With ONE
        // member `SettingsRequest` is not a union, and TypeScript narrows only a union to
        // `never` in the default branch — the assignment is an error today and would start
        // compiling, and start meaning something, the moment a second `settings_*` member
        // appears. Restore it then; until then the router's own exhaustive switch is what
        // refuses an unrouted kind at compile time.
        throw new Error(
          `unsupported settings request: ${JSON.stringify(request)}`,
        );
      }
    }
  };
}

function livePersisted(pluginId: string): Record<string, unknown> | undefined {
  return usePluginStore.getState().pluginSettings[pluginId];
}
