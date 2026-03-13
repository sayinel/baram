// §69 Plugin Extension Context — Capability-gated API surface
import type {
  CommandsAPI,
  Disposable,
  EditorAPI,
  EventsAPI,
  ExtensionContext,
  FilesAPI,
  PluginCapability,
  PluginManifest,
  UIAPI,
} from "./types";

import { listDir, readFile, writeFile } from "../ipc/invoke";
import { logger } from "../utils/logger";

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

// --- Command Registry (shared across all plugins) ---
const commandHandlers = new Map<string, (...args: unknown[]) => unknown>();

// --- Event Bus (shared across all plugins) ---
type EventHandler = (...args: unknown[]) => void;

function createCommandsAPI(
  pluginId: string,
  disposables: Disposable[],
): CommandsAPI {
  return {
    register(id: string, handler: (...args: unknown[]) => unknown): Disposable {
      const fullId = `${pluginId}.${id}`;
      commandHandlers.set(fullId, handler);
      const disposable: Disposable = {
        dispose: () => {
          commandHandlers.delete(fullId);
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

  const ui: UIAPI =
    hasCapability("sidebar") || hasCapability("statusbar")
      ? createUIAPI(disposables)
      : (createDeniedProxy("ui", "sidebar") as UIAPI);

  return {
    pluginId: manifest.id,
    pluginPath,
    subscriptions: disposables,
    commands,
    editor,
    files,
    events,
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
function createUIAPI(disposables: Disposable[]): UIAPI {
  return {
    showNotification(
      message: string,
      type: "error" | "info" | "warning" = "info",
    ): void {
      // Use console for now; can be replaced with toast system
      if (type === "error") logger.error(`[Plugin] ${message}`);
      else if (type === "warning") logger.warn(`[Plugin] ${message}`);
      else logger.info(`[Plugin] ${message}`);
    },
    showStatusBarItem(
      text: string,
      _alignment: "left" | "right" = "right",
    ): Disposable {
      // Status bar integration placeholder
      logger.info(`[Plugin StatusBar] ${text}`);
      const disposable: Disposable = { dispose: () => {} };
      disposables.push(disposable);
      return disposable;
    },
  };
}
