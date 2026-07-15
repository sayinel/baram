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
  StatusBarItem,
  UIAPI,
} from "./types";

import { listDir, readFile, writeFile } from "../ipc/invoke";
import { llmComplete, llmListModels } from "../ipc/llm";
import { pluginHttpFetch } from "../ipc/plugin-invoke";
import { useAIStore } from "../stores/ai/ai";
import { useUIStore } from "../stores/ui/ui";
import { createLLMStream } from "../utils/llm-stream";
import { logger } from "../utils/logger";
import { getConfigForTask } from "../utils/model-selection";
import { isLLMAllowed } from "../utils/privacy-check";
import { usePluginUIStore } from "./plugin-ui-store";

// --- AI API ---
function createAIAPI(pluginId: string): AIAPI {
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
      const models = await llmListModels(
        cfg.provider,
        cfg.apiKey || undefined,
        cfg.baseUrl,
      );
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

// --- Editor API ---
let editorInstance: null | {
  chain: () => Record<string, unknown>;
  commands: Record<string, unknown>;
  getHTML: () => string;
  getText: () => string;
  state: { selection: { from: number; to: number } };
} = null;

/** Create an ExtensionContext with capability-gated API access */
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

  const editor: EditorAPI = hasCapability("editor")
    ? createEditorAPI(false)
    : hasCapability("editor:readonly")
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

  const ui: UIAPI =
    hasCapability("sidebar") ||
    hasCapability("statusbar") ||
    hasCapability("settings")
      ? createUIAPI(manifest.id, capabilities, disposables)
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
    ui,
  };
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

export function setEditorInstance(editor: unknown): void {
  editorInstance = editor as typeof editorInstance;
}

function createEditorAPI(readonly: boolean): EditorAPI {
  return {
    getContent(): string {
      if (!editorInstance) return "";
      return editorInstance.getText();
    },
    setContent(content: string): void {
      if (readonly)
        throw new Error("editor:readonly — setContent is not allowed");
      if (!editorInstance) return;
      (
        editorInstance.commands as Record<
          string,
          (c: { content: string }) => void
        >
      ).setContent({ content });
    },
    getSelection(): { from: number; text: string; to: number } {
      if (!editorInstance) return { from: 0, to: 0, text: "" };
      const { from, to } = editorInstance.state.selection;
      const text = editorInstance.getText().slice(from, to);
      return { from, to, text };
    },
    insertText(text: string): void {
      if (readonly)
        throw new Error("editor:readonly — insertText is not allowed");
      if (!editorInstance) return;
      (
        editorInstance.commands as Record<string, (t: string) => void>
      ).insertContent(text);
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
      useUIStore.getState().showToast(message, type);
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
  };
}
