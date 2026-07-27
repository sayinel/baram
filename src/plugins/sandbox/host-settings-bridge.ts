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
import type { PluginCapability, PluginSettingField } from "../types";
import type { SandboxHostRequest } from "./protocol";
import type { SandboxSession } from "./sandbox-session";

import { pluginSandboxStage } from "../../ipc/plugin-invoke";
import { usePluginStore } from "../../stores/system/plugin";
import { logger } from "../../utils/logger";
import { resolvePluginSettings } from "../plugin-settings";
import { createRequiredCapabilityGate } from "./capability-gate";

/**
 * How long a value must hold still before the plugin is told (§260 Phase 4c).
 *
 * A string field writes to the store on every keystroke, so an undebounced notification is
 * one frame per character — each of which makes the plugin pull, which is a broker call and
 * a staged slot write. `RateClass::Transport` (150/s) would not break, but the work is
 * pointless: nobody wants the intermediate values of a half-typed prefix.
 */
export const SETTINGS_NOTIFY_DEBOUNCE_MS = 250;

/**
 * The event name a plugin subscribes to. Not a `PluginEventName` and not delivered through
 * `sandbox-event-bridge`, deliberately: that bridge carries APP events (what the user did to
 * a file) and gates them on `events`. This one is the settings feature notifying the plugin
 * whose own configuration moved, so it is gated on `settings` — an author who declared
 * `settings` would otherwise be left wondering why their plugin never updates. It is safe to
 * make that exception for exactly this frame because it carries NO PAYLOAD: there is nothing
 * in it to leak, and the values still travel only as a staged pull the plugin asks for.
 */
export const SETTINGS_CHANGED_EVENT = "settings:changed";

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

/**
 * Tell one sandbox when its OWN settings change. Returns an unsubscriber.
 *
 * Only this plugin's slice is watched, so one plugin's edit does not wake every other
 * sandbox. A plugin without the `settings` capability is not subscribed at all rather than
 * subscribed-and-skipped: it cannot read the values, so the frame would be an invitation to
 * call something that refuses.
 */
export function watchPluginSettings(options: {
  capabilities: readonly PluginCapability[];
  pluginId: string;
  session: Pick<SandboxSession, "deliverEvent">;
  /** Injectable for tests; defaults to the live plugin store. */
  subscribe?: (listener: () => void) => () => void;
}): () => void {
  const { capabilities, pluginId, session } = options;
  if (!capabilities.includes("settings")) return () => undefined;
  const subscribe = options.subscribe ?? liveSubscribe(pluginId);
  let timer: null | ReturnType<typeof setTimeout> = null;
  const stop = subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        session.deliverEvent(SETTINGS_CHANGED_EVENT, []);
      } catch (err) {
        // A closed session is the ordinary case for a debounce that outlived an unload by
        // less than its delay; nothing here is worth failing a store update over.
        logger.debug(`[Sandbox] ${pluginId}: settings notify skipped`, err);
      }
    }, SETTINGS_NOTIFY_DEBOUNCE_MS);
  });
  return () => {
    // The pending timer goes with the subscription, or a notification lands in a session
    // the loader has already torn down.
    if (timer) clearTimeout(timer);
    timer = null;
    stop();
  };
}

function livePersisted(pluginId: string): Record<string, unknown> | undefined {
  return usePluginStore.getState().pluginSettings[pluginId];
}

function liveSubscribe(pluginId: string): (listener: () => void) => () => void {
  return (listener) =>
    usePluginStore.subscribe((state, previous) => {
      // Identity on THIS plugin's slice, not deep equality: `setPluginSetting` always
      // replaces the slice it writes, and every other store action leaves it untouched — so
      // a plugin install or a registry refresh does not wake a sandbox.
      if (
        state.pluginSettings[pluginId] === previous.pluginSettings[pluginId]
      ) {
        return;
      }
      listener();
    });
}
