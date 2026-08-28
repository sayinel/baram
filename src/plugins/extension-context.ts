// §69 Plugin Extension Context — Capability-gated API surface
import type {
  AIAPI,
  CommandRegisterOptions,
  CommandsAPI,
  Disposable,
  EditorAPI,
  EventsAPI,
  ExtensionContext,
  FilesAPI,
  NetworkAPI,
  PluginCapability,
  PluginManifest,
  SettingsAPI,
  StorageAPI,
  UIAPI,
} from "./types";

import { listDir, readFile, writeFile } from "../ipc/invoke";
import {
  pluginHttpFetch,
  pluginStorageList,
  pluginStorageRead,
  pluginStorageRemove,
  pluginStorageWrite,
} from "../ipc/plugin-invoke";
import { usePluginStore } from "../stores/system/plugin";
import { logger } from "../utils/logger";
import { createAIAPI } from "./plugin-ai-policy";
import {
  commandHandlers,
  editorRefusalMessage,
  editorSurfaceBlocked,
  type EventHandler,
  eventListeners,
  getEditorInstance,
  NO_EDITOR_OPEN,
  type PluginEditorHandle,
  readSelection,
} from "./plugin-host-registry";
import { declaredSettingsFor, resolvePluginSettings } from "./plugin-settings";
import { usePluginUIStore } from "./plugin-ui-store";
import { createUIAPI } from "./trusted/ui-api";
import {
  EDITOR_READ_CAPABILITIES,
  EDITOR_WRITE_CAPABILITIES,
  UI_CAPABILITIES,
} from "./types";

// --- Re-export barrel (§298 review, safety proc a) ---
// `extension-context.ts` used to define all of these itself. They now live in
// `plugin-host-registry.ts` / `plugin-ai-policy.ts` / `trusted/ui-api.ts`, split by
// trust-tier ownership rather than by "everything about plugin capabilities". Re-exported
// here, under their original names and this original path, so every existing
// `from "./extension-context"` import (`plugin-lifecycle.ts`, `plugin-loader.ts`, the
// CommandPalette / status-bar components, and the test suite) keeps resolving without
// changes. New tier-neutral code should import `plugin-host-registry.ts` /
// `plugin-ai-policy.ts` directly instead of reaching through this barrel — see
// `sandbox/host-editor-bridge.ts` and `sandbox/host-ai-bridge.ts` for the pattern.
export { createAIAPI } from "./plugin-ai-policy";
export {
  editorRefusalMessage,
  editorSurfaceBlocked,
  emitPluginEvent,
  executePluginCommand,
  getEditorInstance,
  NO_EDITOR_OPEN,
  readSelection,
  registerHostCommandHandler,
  setEditorInstance,
  setEditorSurfaceBlocked,
} from "./plugin-host-registry";
export type { PluginEditorHandle } from "./plugin-host-registry";
export { unregisterPluginUI } from "./trusted/ui-api";

function createCommandsAPI(
  pluginId: string,
  disposables: Disposable[],
): CommandsAPI {
  return {
    register(
      id: string,
      handler: (...args: unknown[]) => unknown,
      opts?: CommandRegisterOptions,
    ): Disposable {
      const fullId = `${pluginId}.${id}`;
      commandHandlers.set(fullId, handler);
      const showInPalette = opts?.paletteVisible === true || !!opts?.title;
      if (showInPalette) {
        usePluginUIStore.getState().registerPaletteCommand({
          commandId: fullId,
          pluginId,
          title: opts?.title ?? id,
        });
      }
      const disposable: Disposable = {
        dispose: () => {
          commandHandlers.delete(fullId);
          if (showInPalette) {
            usePluginUIStore.getState().removePaletteCommand(fullId);
          }
        },
      };
      disposables.push(disposable);
      return disposable;
    },
    async execute(id: string, ...args: unknown[]): Promise<unknown> {
      const handler =
        commandHandlers.get(id) ?? commandHandlers.get(`${pluginId}.${id}`);
      if (!handler) throw new Error(`Command not found: ${id}`);
      return handler(...args);
    },
  };
}

/** Creates a denied proxy that throws on any property access */
function createDeniedProxy(
  apiName: string,
  requiredCapability: PluginCapability,
): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === Symbol.toPrimitive) {
          return (_hint: string) => `[DeniedAPI: ${apiName}]`;
        }
        if (prop === Symbol.toStringTag) return `DeniedAPI(${apiName})`;
        if (prop === "then" || prop === "toJSON") return undefined;
        if (prop === "toString" || prop === "valueOf") {
          return () => `[DeniedAPI: ${apiName}]`;
        }
        throw new Error(
          `Plugin requires "${requiredCapability}" capability to access ${apiName}.${String(prop)}. ` +
            `Add "${requiredCapability}" to the capabilities array in baram-plugin.json.`,
        );
      },
    },
  );
}

function createEventsAPI(disposables: Disposable[]): EventsAPI {
  return {
    on(event: string, handler: EventHandler): Disposable {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set());
      }
      eventListeners.get(event)!.add(handler);
      const disposable: Disposable = {
        dispose: () => {
          eventListeners.get(event)?.delete(handler);
        },
      };
      disposables.push(disposable);
      return disposable;
    },
    emit(event: string, ...args: unknown[]): void {
      eventListeners.get(event)?.forEach((handler) => {
        try {
          handler(...args);
        } catch (e) {
          logger.error(`[Plugin Event Error] ${event}:`, e);
        }
      });
    },
  };
}

// --- Network API ---
function createNetworkAPI(): NetworkAPI {
  return {
    fetch(url, init) {
      return pluginHttpFetch(url, init);
    },
  };
}

// --- Settings API (§260 Phase 4c) ---
/**
 * The user's answers to this plugin's declared fields — read-only, like the sandboxed
 * tier's, and through the SAME resolver so both tiers see the same values for the same
 * manifest.
 *
 * Synchronous here because the store is in this realm. Read on every call rather than
 * captured: the user can change a value while the plugin is loaded, and a trusted plugin
 * has no `settings:changed` frame — it runs in the main realm and can subscribe to
 * `usePluginStore` itself if it wants to be told.
 *
 * A trusted plugin could of course read the store directly. That is not what this is for:
 * it is the tier-portable spelling, so the same plugin source works in both tiers, and it
 * is what keeps "resolved against the current manifest" from being re-implemented by hand.
 */
function createSettingsAPI(manifest: PluginManifest): SettingsAPI {
  return {
    getAll: () =>
      resolvePluginSettings(
        declaredSettingsFor(manifest),
        usePluginStore.getState().pluginSettings[manifest.id],
      ),
  };
}

// --- Storage API ---
function createStorageAPI(pluginId: string): StorageAPI {
  return {
    list() {
      return pluginStorageList(pluginId);
    },
    read(key) {
      return pluginStorageRead(pluginId, key);
    },
    remove(key) {
      return pluginStorageRemove(pluginId, key);
    },
    write(key, value) {
      return pluginStorageWrite(pluginId, key, value);
    },
  };
}

/** Create an ExtensionContext with capability-gated API access */
// §259 SECURITY LIMITATION — this capability gate is NOT a trust boundary.
//
// Plugins execute in the app's own JavaScript realm (see plugin-loader.ts), so
// the `DeniedProxy` / `hasCapability` checks below only constrain a *cooperating*
// plugin that goes through the ExtensionContext. A malicious plugin can ignore
// this object entirely and `import { invoke } from "@tauri-apps/api/core"` to
// call any Tauri command directly (FS, LLM, keyring, plugin storage, …). The
// Rust backend does not — and in the same realm cannot — verify which plugin a
// call came from, so an ACL alone can never distinguish the app's own calls
// from a plugin's. Real enforcement requires isolating plugin execution and
// verifying caller identity + capabilities per call. That is what the SANDBOXED tier
// is (§260 Phases 2-4): a separate webview plus a Rust broker. This function builds the
// TRUSTED tier's context, where the checks below are an API gate and not a boundary —
// the plugin shares this realm and can reach around them. Installing one requires an
// explicit full-trust acknowledgement (§260 Phase 5, `PluginConsentDialog`); the
// build-time containment that used to stand in for it is gone.
export function createExtensionContext(
  manifest: PluginManifest,
  pluginPath: string,
): ExtensionContext {
  const capabilities = new Set(manifest.capabilities);
  const disposables: Disposable[] = [];

  const hasCapability = (cap: PluginCapability) => capabilities.has(cap);

  const ai: AIAPI = hasCapability("ai")
    ? createAIAPI(manifest.id)
    : (createDeniedProxy("ai", "ai") as AIAPI);

  const commands: CommandsAPI = hasCapability("commands")
    ? createCommandsAPI(manifest.id, disposables)
    : (createDeniedProxy("commands", "commands") as CommandsAPI);

  // The shared lists, not a hand-written chain (§260 Phase 4b code review, M1): the
  // sandboxed tier gates the same operations on the same grants, and 4a's own review
  // already fixed this shape once for `ui`.
  const editor: EditorAPI = EDITOR_WRITE_CAPABILITIES.some(hasCapability)
    ? createEditorAPI(false)
    : EDITOR_READ_CAPABILITIES.some(hasCapability)
      ? createEditorAPI(true)
      : (createDeniedProxy("editor", "editor") as EditorAPI);

  const files: FilesAPI = hasCapability("files")
    ? createFilesAPI(false)
    : hasCapability("files:readonly")
      ? createFilesAPI(true)
      : (createDeniedProxy("files", "files") as FilesAPI);

  const events: EventsAPI = hasCapability("events")
    ? createEventsAPI(disposables)
    : (createDeniedProxy("events", "events") as EventsAPI);

  const network: NetworkAPI = hasCapability("network")
    ? createNetworkAPI()
    : (createDeniedProxy("network", "network") as NetworkAPI);

  const settings: SettingsAPI = hasCapability("settings")
    ? createSettingsAPI(manifest)
    : (createDeniedProxy("settings", "settings") as SettingsAPI);

  const storage: StorageAPI = hasCapability("storage")
    ? createStorageAPI(manifest.id)
    : (createDeniedProxy("storage", "storage") as StorageAPI);

  // §260 Phase 4a code review (M5) — the SHARED list, not a second inline copy of it.
  // `UI_CAPABILITIES` claimed to be the one rule both tiers use while this chain was
  // still hand-written here; a comment that says "one list" over two lists is how one
  // gets fixed and the other forgotten.
  const ui: UIAPI = UI_CAPABILITIES.some(hasCapability)
    ? createUIAPI(manifest.id, capabilities, disposables, manifest.name)
    : (createDeniedProxy("ui", "sidebar") as UIAPI);

  return {
    ai,
    pluginId: manifest.id,
    pluginPath,
    subscriptions: disposables,
    commands,
    editor,
    files,
    events,
    network,
    settings,
    storage,
    ui,
  };
}

function createEditorAPI(readonly: boolean): EditorAPI {
  /**
   * The live editor, or a refusal — the trusted tier's twin of `host-editor-bridge`'s `live()`
   * (#322). Every method used to consult only `editorInstance`, so all five stale-surface states
   * reached it: source mode, a non-markdown tab, a progressive load, the deferred window at the
   * start of a tab switch, and no tabs at all. In each one a read was silently STALE and a write
   * silently DISCARDED — by the next save, the next source-mode toggle, or the pending
   * `updateState`. A plugin doing read-modify-write lost the user's edits and the API reported
   * success.
   *
   * ‼️ Throwing where it used to return `""` / `{from:0,to:0,text:""}` / nothing is a deliberate
   * behaviour change, and the benign-looking defaults were the dangerous part: a plugin that
   * cannot tell "no editor" from "empty file" reads `""`, transforms it, writes it back, and has
   * emptied the document. The sandboxed tier made the same call in Phase 4b. The blast radius is
   * plugin authors only — `plugin-release.yml` refuses to publish a non-sandboxed plugin, so no
   * trusted plugin is installable from the registry.
   */
  const live = (method: string): PluginEditorHandle => {
    // Surface FIRST, exactly as the sandboxed tier orders it: an editor instance stays mounted in
    // source mode and on a non-markdown tab but does not hold the tab's content there, so
    // answering from it returns a stale document and accepts a write the next save discards.
    const blocked = editorSurfaceBlocked();
    if (blocked) throw new Error(editorRefusalMessage(method, blocked));
    const instance = getEditorInstance();
    if (!instance)
      throw new Error(editorRefusalMessage(method, NO_EDITOR_OPEN));
    return instance;
  };

  return {
    getContent(): string {
      return live("getContent").getText();
    },
    setContent(content: string): void {
      if (readonly)
        throw new Error("editor:readonly — setContent is not allowed");
      const instance = live("setContent");
      (
        instance.commands as Record<string, (c: { content: string }) => void>
      ).setContent({ content });
    },
    getSelection(): { from: number; text: string; to: number } {
      return readSelection(live("getSelection"));
    },
    insertText(text: string): void {
      if (readonly)
        throw new Error("editor:readonly — insertText is not allowed");
      const instance = live("insertText");
      (instance.commands as Record<string, (t: string) => void>).insertContent(
        text,
      );
    },
  };
}

// --- Files API ---
function createFilesAPI(readonly: boolean): FilesAPI {
  return {
    async readFile(path: string): Promise<string> {
      return readFile(path);
    },
    async writeFile(path: string, content: string): Promise<void> {
      if (readonly)
        throw new Error("files:readonly — writeFile is not allowed");
      return writeFile(path, content);
    },
    async listDir(path: string): Promise<string[]> {
      const entries = await listDir(path);
      return entries.map((e) => e.name);
    },
  };
}
