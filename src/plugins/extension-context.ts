// §69 Plugin Extension Context — Capability-gated API surface
import type {
  AIAPI,
  AICompleteOptions,
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
  StatusBarItem,
  StorageAPI,
  UIAPI,
} from "./types";
import type { Schema } from "@tiptap/pm/model";
import type { EditorState, Transaction } from "@tiptap/pm/state";

import { listDir, readFile, writeFile } from "../ipc/invoke";
import { llmComplete, llmListModels } from "../ipc/llm";
import {
  pluginHttpFetch,
  pluginStorageList,
  pluginStorageRead,
  pluginStorageRemove,
  pluginStorageWrite,
} from "../ipc/plugin-invoke";
import { useAIStore } from "../stores/ai/ai";
import { useEditorStore } from "../stores/editor/editor";
import { usePluginStore } from "../stores/system/plugin";
import { useUIStore } from "../stores/ui/ui";
import { isTabLoading, loadedTabId } from "../utils/editor/programmatic-update";
import { createLLMStream } from "../utils/llm-stream";
import { logger } from "../utils/logger";
import { getConfigForTask } from "../utils/model-selection";
import { isLLMAllowed } from "../utils/privacy-check";
import { declaredSettingsFor, resolvePluginSettings } from "./plugin-settings";
import { usePluginUIStore } from "./plugin-ui-store";
import {
  EDITOR_READ_CAPABILITIES,
  EDITOR_WRITE_CAPABILITIES,
  UI_CAPABILITIES,
} from "./types";

// --- AI API ---
// Exported (§260 3c-2c) so the SANDBOXED tier's host-mediated `ai` runs the very
// same policy — privacy mode, per-task model/provider, `createLLMStream` cleanup in
// `finally`. A separate implementation for the sandbox would be a second place for
// privacy mode to be forgotten. See `sandbox/host-ai-bridge.ts`.
export function createAIAPI(pluginId: string): AIAPI {
  const start = async (
    prompt: string,
    opts: AICompleteOptions | undefined,
    onToken: (t: string) => void,
  ): Promise<void> => {
    const cfg = getConfigForTask("chat");
    const { privacyMode } = useAIStore.getState();
    if (!isLLMAllowed(privacyMode, cfg.provider)) {
      throw new Error(
        "Privacy mode is active — only local (Ollama) models are allowed.",
      );
    }
    const requestId = `plugin-${pluginId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    let resolveDone: () => void;
    let rejectDone: (e: unknown) => void;
    const done = new Promise<void>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });
    const cleanup = await createLLMStream(requestId, {
      onToken,
      onDone: () => resolveDone(),
      onError: (e) => rejectDone(new Error(e)),
    });
    try {
      await llmComplete(
        prompt,
        cfg.model,
        requestId,
        opts?.systemPrompt,
        opts?.maxTokens,
        cfg.provider,
        cfg.baseUrl,
        privacyMode,
      );
      await done;
    } finally {
      cleanup();
    }
  };
  return {
    async complete(prompt, opts) {
      let buffer = "";
      await start(prompt, opts, (t) => {
        buffer += t;
      });
      return buffer;
    },
    async listModels() {
      const cfg = getConfigForTask("chat");
      const models = await llmListModels(cfg.provider, cfg.baseUrl);
      return models.map((m) => ({ id: m.id, name: m.name }));
    },
    async stream(prompt, opts, onToken) {
      await start(prompt, opts, onToken);
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

// --- Command Registry (shared across all plugins) ---
const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();

// --- Event Bus (shared across all plugins) ---
type EventHandler = (...args: unknown[]) => void;

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
const eventListeners = new Map<string, Set<EventHandler>>();

// --- Editor API ---
/**
 * What the plugin tiers need from the live editor.
 *
 * §260 Phase 4b widened this from a hand-written structural shape to the real
 * ProseMirror types, because the sandboxed tier's `editor` service serialises the
 * document through the app's own pipeline (`state.doc` → markdown) and writes through a
 * single transaction (`state.tr` → `view.dispatch`). Structural guesses were what let the
 * selection bug below survive: `{ selection: { from, to } }` typechecks fine while saying
 * nothing about what those numbers index into.
 */
export interface PluginEditorHandle {
  chain: () => Record<string, unknown>;
  commands: Record<string, unknown>;
  getHTML: () => string;
  getText: () => string;
  schema: Schema;
  state: EditorState;
  view: { dispatch: (tr: Transaction) => void };
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

let editorInstance: null | PluginEditorHandle = null;

/**
 * Why the Tiptap document is not the tab's authoritative content right now, or `null`.
 *
 * §260 Phase 4b security review (LOW-3) — an editor instance being present does not mean
 * it holds what the user is editing. In Source Mode the user edits CodeMirror while the
 * Tiptap doc keeps its pre-toggle content (`use-source-mode.ts`), and for a source-mode or
 * non-markdown tab `handleSave` writes `sourceContentRef` and ignores the Tiptap doc
 * entirely (`use-file-operations.ts`). A plugin reading through this surface would then
 * get a STALE document, and a write would be silently discarded on the next toggle or
 * save — a read-modify-write losing the user's edits with no error anywhere.
 *
 * A string rather than a boolean so the refusal can say which case it is: a plugin that
 * cannot distinguish "wrong surface" from "no editor" cannot tell the user what to do.
 *
 * ‼️ Initialised BLOCKED, not clear (§260 Phase 4b code review, M4). For a guard whose
 * whole job is preventing silent data loss, "nobody has told me yet" must not read as "all
 * clear" — the same fail-closed rule as `serviceOf`'s unknown prefix and Rust's
 * `is_registered`. The App effect clears it on mount, long before any plugin activates,
 * so this costs nothing in practice; it just stops the guarantee resting on that ordering.
 */
let editorSurfaceBlockedReason: null | string =
  "the editor surface has not been reported yet";

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

/**
 * The reason given when there is no editor at all — as opposed to an editor holding an empty file.
 *
 * An error rather than an empty document, in BOTH tiers: a plugin that cannot tell the two apart
 * reads `""`, transforms it, writes it back, and has emptied the user's file.
 */
export const NO_EDITOR_OPEN = "no editor is open";

/**
 * How every `editor.*` refusal is worded, in both tiers (#322).
 *
 * One home for the sentence rather than two call sites composing the same template — the reason
 * `legacyEntryMessage` has one too. It is a formatter and not a "should I refuse?" predicate
 * because the sandboxed tier injects its own `surfaceBlocked` and `editor` getters for tests, so
 * only the wording can be shared, not the decision.
 */
export function editorRefusalMessage(method: string, reason: string): string {
  return `editor.${method}: ${reason}`;
}

/**
 * Why the plugin editor surface is unusable right now, or `null` when the Tiptap document
 * really is the tab's content. See `editorSurfaceBlockedReason`.
 */
export function editorSurfaceBlocked(): null | string {
  if (editorSurfaceBlockedReason) return editorSurfaceBlockedReason;
  // Progressive load, checked LIVE rather than through the App effect (§260 Phase 4b
  // security review, Q6): during a large-document tab switch or source-mode toggle the
  // editor holds only the first chunk while `appendChunksProgressively` fills the rest, so
  // a read here returns a TRUNCATED document and a read-modify-write would save the
  // truncation. `loadingTabs` is a plain Set — it changes without a React render, so an
  // effect would observe it late; reading it per request cannot.
  const { activeTabId } = useEditorStore.getState();
  // The fourth instance of this class (§260 Phase 4b re-review, M3), and the same
  // question: is the Tiptap document the tab's content? With no tab there is nothing for
  // it to be the content OF. Reachable — closing the last tab sets `activeTabId` to null
  // — and `setEditor` is never called with null (`App.tsx` falls back to the shared
  // editor), so `live()` would otherwise hand a plugin the document the user just closed
  // as though it were open — for a macrotask while the deferred empty-document install is
  // pending, and then indefinitely, since that branch never calls `markContentLoaded`.
  //
  // ‼️ A §89 single-file window has no tabs at all (`FileEditorLayout` never touches the
  // tab store), so this would block its editor surface permanently. Harmless today because
  // those realms skip `initializePlugins` entirely — but if plugins are ever loaded there,
  // this predicate needs a file-window branch rather than a debugging session.
  if (!activeTabId) return "no document is open";
  if (isTabLoading(activeTabId)) return "the document is still loading";
  // …and the window BEFORE that flag is set (§260 Phase 4b security review, LOW). The
  // store's `activeTabId` flips at the start of a tab switch while installation is still
  // deferred, so for a macrotask (cache hit) or a worker round trip (cache miss) the editor
  // still holds the OUTGOING tab's document — a read would return another file's content
  // and a write would be discarded by the pending `updateState`. Every install path ends at
  // `markContentLoaded`, so this is exactly "has the editor caught up yet?".
  if (loadedTabId() !== activeTabId) {
    return "the editor has not finished switching to this tab";
  }
  return null;
}

/** Emit a plugin event from the host */
export function emitPluginEvent(event: string, ...args: unknown[]): void {
  eventListeners.get(event)?.forEach((handler) => {
    try {
      handler(...args);
    } catch (e) {
      logger.error(`[Plugin Event Error] ${event}:`, e);
    }
  });
}

/** Execute a plugin command from the host */
export async function executePluginCommand(
  id: string,
  ...args: unknown[]
): Promise<unknown> {
  const handler = commandHandlers.get(id);
  if (!handler) throw new Error(`Plugin command not found: ${id}`);
  return handler(...args);
}

/**
 * The live editor, or `null` before one is mounted (and in a §89 file-mode window until
 * its editor is ready). Exported for the sandboxed tier's host bridge, which needs the
 * document and the schema rather than the trusted tier's convenience methods.
 */
export function getEditorInstance(): null | PluginEditorHandle {
  return editorInstance;
}

/**
 * The selected text, and the ProseMirror positions it came from.
 *
 * ‼️ `from`/`to` are ProseMirror DOCUMENT positions — they count node boundaries — so they
 * cannot index a flat string. This used to be `getText().slice(from, to)`, which silently
 * returns the wrong text for any document with more than one block: the offsets diverge by
 * one per block boundary crossed. `doc.textBetween` is the app's own idiom for this
 * (`utils/ai-commands.ts`), though the `"\n"` separator is an IMPROVEMENT on that call
 * site rather than a copy of it — `ai-commands` passes none, so a multi-block selection
 * comes back as one run-on line. Stated because this changes the trusted tier's
 * observable output too (§260 Phase 4b code review, N4).
 *
 * Shared by both tiers (§260 Phase 4b) so the fix cannot land in one and not the other.
 */
export function readSelection(editor: PluginEditorHandle): {
  from: number;
  text: string;
  to: number;
} {
  const { from, to } = editor.state.selection;
  return { from, text: editor.state.doc.textBetween(from, to, "\n"), to };
}

/**
 * §260 3c-1 — register a host-side command handler by its full id
 * (`${pluginId}.${commandId}`). Sandboxed plugins have no main-realm
 * ExtensionContext; their command bodies run in the sandbox webview, so the
 * loader registers a thin handler here that forwards to `session.invokeCommand`.
 * Reuses the same registry the CommandPalette executes through.
 */
export function registerHostCommandHandler(
  fullId: string,
  handler: (...args: unknown[]) => unknown,
): Disposable {
  commandHandlers.set(fullId, handler);
  return { dispose: () => void commandHandlers.delete(fullId) };
}

export function setEditorInstance(editor: unknown): void {
  editorInstance = editor as null | PluginEditorHandle;
}

/**
 * Record why the Tiptap document is not the active tab's content, or `null` to clear it.
 * Called by the app whenever the surface changes; see `editorSurfaceBlockedReason`.
 */
export function setEditorSurfaceBlocked(reason: null | string): void {
  editorSurfaceBlockedReason = reason;
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
  const live = (method: string): NonNullable<typeof editorInstance> => {
    // Surface FIRST, exactly as the sandboxed tier orders it: an editor instance stays mounted in
    // source mode and on a non-markdown tab but does not hold the tab's content there, so
    // answering from it returns a stale document and accepts a write the next save discards.
    const blocked = editorSurfaceBlocked();
    if (blocked) throw new Error(editorRefusalMessage(method, blocked));
    if (!editorInstance)
      throw new Error(editorRefusalMessage(method, NO_EDITOR_OPEN));
    return editorInstance;
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

// --- UI API ---
let uiItemCounter = 0;

/** Unregister all UI state (status-bar items + injected styles) for a plugin. */
export function unregisterPluginUI(pluginId: string): void {
  usePluginUIStore.getState().unregisterPlugin(pluginId);
  document.head
    .querySelectorAll(`style[data-baram-plugin="${pluginId}"]`)
    .forEach((n) => n.remove());
}

function createUIAPI(
  pluginId: string,
  capabilities: Set<PluginCapability>,
  disposables: Disposable[],
  /**
   * §260 Phase 4a security re-review — the trusted tier attributes its toasts too, or
   * "no badge" would not actually mean "the app is speaking": a trusted plugin's message
   * would read as the app's own. Out of §260's boundary scope (a trusted plugin can call
   * the store directly), but it is what makes the badge a usable signal for the user.
   */
  displayName?: string,
): UIAPI {
  const require = (cap: PluginCapability, method: string) => {
    if (!capabilities.has(cap)) {
      throw new Error(
        `Plugin requires "${cap}" capability to call ui.${method}. ` +
          `Add "${cap}" to the capabilities array in baram-plugin.json.`,
      );
    }
  };
  return {
    showNotification(
      message: string,
      type?: "error" | "info" | "warning",
    ): void {
      useUIStore
        .getState()
        .showToast(message, type, displayName?.trim() || pluginId);
    },
    showStatusBarItem(
      text: string,
      align: "left" | "right" = "right",
    ): StatusBarItem {
      require("statusbar", "showStatusBarItem");
      const itemId = `${pluginId}:sb:${++uiItemCounter}`;
      usePluginUIStore
        .getState()
        .registerStatusBarItem({ align, itemId, pluginId, text });
      const item: StatusBarItem = {
        setText: (t) =>
          usePluginUIStore.getState().updateStatusBarItem(itemId, t),
        dispose: () => usePluginUIStore.getState().removeStatusBarItem(itemId),
      };
      disposables.push({ dispose: item.dispose });
      return item;
    },
    addSidebarPanel(opts) {
      require("sidebar", "addSidebarPanel");
      const panelId = `${pluginId}:${opts.id}`;
      usePluginUIStore.getState().registerSidebarPanel({
        icon: opts.icon,
        onMount: opts.onMount,
        onUnmount: opts.onUnmount,
        panelId,
        pluginId,
        title: opts.title,
      });
      const disposable: Disposable = {
        dispose: () => usePluginUIStore.getState().removeSidebarPanel(panelId),
      };
      disposables.push(disposable);
      return disposable;
    },
    addSettingsTab(opts) {
      require("settings", "addSettingsTab");
      const tabId = `${pluginId}:${opts.id}`;
      usePluginUIStore.getState().registerSettingsTab({
        onMount: opts.onMount,
        onUnmount: opts.onUnmount,
        pluginId,
        tabId,
        title: opts.title,
      });
      const disposable: Disposable = {
        dispose: () => usePluginUIStore.getState().removeSettingsTab(tabId),
      };
      disposables.push(disposable);
      return disposable;
    },
    // Injects into document.head (light DOM); does NOT reach Shadow-DOM panel
    // content — plugins style shadow content from inside onMount(el).
    addStyle(css: string): Disposable {
      const el = document.createElement("style");
      el.setAttribute("data-baram-plugin", pluginId);
      el.textContent = css;
      document.head.appendChild(el);
      const disposable: Disposable = { dispose: () => el.remove() };
      disposables.push(disposable);
      return disposable;
    },
    registerFileViewer(opts) {
      require("viewer", "registerFileViewer");
      const viewerId = `${pluginId}:${opts.id}`;
      usePluginUIStore.getState().registerFileViewer({
        // Normalize once at the boundary so matching never re-parses
        extensions: opts.extensions.map((e) =>
          e.replace(/^\./, "").toLowerCase(),
        ),
        onMount: opts.onMount,
        onUnmount: opts.onUnmount,
        onUpdate: opts.onUpdate,
        pluginId,
        viewerId,
      });
      const disposable: Disposable = {
        dispose: () => usePluginUIStore.getState().removeFileViewer(viewerId),
      };
      disposables.push(disposable);
      return disposable;
    },
  };
}
