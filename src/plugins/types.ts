// §69 Plugin Marketplace — Core Types

export interface AIAPI {
  complete(prompt: string, opts?: AICompleteOptions): Promise<string>;
  listModels(): Promise<AIModel[]>;
  stream(
    prompt: string,
    opts: AICompleteOptions,
    onToken: (token: string) => void,
  ): Promise<void>;
}

export interface AICompleteOptions {
  maxTokens?: number;
  systemPrompt?: string;
}

export interface AIModel {
  id: string;
  name: string;
}

export interface CommandRegisterOptions {
  paletteVisible?: boolean;
  title?: string;
}

export interface CommandsAPI {
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  register(
    id: string,
    handler: (...args: unknown[]) => unknown,
    opts?: CommandRegisterOptions,
  ): Disposable;
}

export interface Disposable {
  dispose(): void;
}

export interface EditorAPI {
  getContent(): string;
  getSelection(): { from: number; text: string; to: number };
  insertText(text: string): void;
  setContent(content: string): void;
}

export interface EventsAPI {
  emit(event: string, ...args: unknown[]): void;
  on(event: string, handler: (...args: unknown[]) => void): Disposable;
}

export interface ExtensionContext {
  ai: AIAPI;
  commands: CommandsAPI;
  editor: EditorAPI;
  events: EventsAPI;
  files: FilesAPI;
  network: NetworkAPI;
  pluginId: string;
  pluginPath: string;
  storage: StorageAPI;
  subscriptions: Disposable[];
  ui: UIAPI;
}

export interface FilesAPI {
  listDir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface InstalledPlugin {
  checksum: string;
  enabled: boolean;
  installedAt: number;
  installPath: string;
  isDev?: boolean;
  manifest: PluginManifest;
  updatedAt: number;
}

export interface LoadedPlugin {
  // §260 3c-1 — absent for sandboxed plugins (they run in a separate webview, not
  // via a main-realm ExtensionContext); present for trusted (same-realm) plugins.
  context?: ExtensionContext;
  disposables: Disposable[];
  id: string;
  manifest: PluginManifest;
  module: PluginModule;
  /**
   * §260 3c-2a — async teardown the loader AWAITS on unload. `Disposable.dispose`
   * is sync-only, but sandbox teardown must complete before the next load or a
   * late `plugin_sandbox_deregister` revokes the new registration. Sandboxed
   * plugins only.
   */
  teardown?: () => Promise<void>;
}

export interface NetworkAPI {
  fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>;
}

export type PluginCapability =
  | "ai"
  | "commands"
  | "editor"
  | "editor:readonly"
  | "events"
  | "files"
  | "files:readonly"
  | "network"
  | "settings"
  | "sidebar"
  | "statusbar"
  | "storage";

/**
 * §260 declarative contribution surface for sandboxed plugins. Populated in
 * the manifest; consumed by the sandbox runtime in later phases. Every field
 * is serializable (crosses the plugin/host boundary as data).
 */
export interface PluginContributions {
  commands?: Array<{ id: string; palette?: boolean; title: string }>;
  menu?: Array<{ command: string; id: string; title: string; when?: string }>;
  settings?: Array<{
    default?: boolean | number | string;
    key: string;
    label: string;
    type: "boolean" | "number" | "string";
  }>;
  statusBar?: Array<{
    command?: string;
    id: string;
    text: string;
    tooltip?: string;
  }>;
}

export type PluginEventName = "editor:ready" | "file:open" | "file:save";

export interface PluginFetchInit {
  body?: string;
  headers?: Record<string, string>;
  method?: string;
}

export interface PluginFetchResponse {
  body: string;
  headers: Record<string, string>;
  status: number;
}

/**
 * §260 Phase 4a — what a sandboxed plugin is told when a file event fires. Carries a
 * VAULT-RELATIVE path and the context to resolve it against; no absolute path ever
 * crosses the sandbox boundary (see `SandboxFilesAPI`). Pass `context` straight back to
 * `files.*` so a vault switch between the event and the call cannot silently redirect
 * it to a same-named file in another vault.
 */
export interface PluginFileEvent {
  context: string;
  path: string;
}

export interface PluginManifest {
  author: string;
  capabilities: PluginCapability[];
  contributions?: PluginContributions;
  dependencies?: string[];
  description: string;
  engines: { baram: string };
  homepage?: string;
  icon?: string;
  id: string;
  keywords?: string[];
  license: string;
  main: string;
  name: string;
  repository?: string;
  tiptapExtensions?: TiptapExtensionDef[];
  trust: PluginTrust;
  version: string;
}

export interface PluginModule {
  [key: string]: unknown;
  activate?(context: ExtensionContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

export interface PluginSettingsTabOptions {
  id: string;
  onMount(el: HTMLElement): void;
  onUnmount?(el: HTMLElement): void;
  title: string;
}

export interface PluginSidebarPanelOptions {
  icon?: string;
  id: string;
  onMount(el: HTMLElement): void;
  onUnmount?(el: HTMLElement): void;
  title: string;
}

export type PluginStatus =
  "disabled" | "enabled" | "installing" | "not-installed";

export type PluginTrust = "sandboxed" | "trusted";

export interface RegistryEntry {
  author: string;
  capabilities: PluginCapability[];
  checksum: string;
  description: string;
  downloads?: number;
  downloadUrl: string;
  engines: { baram: string };
  homepage?: string;
  icon?: string;
  id: string;
  keywords?: string[];
  license: string;
  name: string;
  repository?: string;
  trust?: PluginTrust;
  version: string;
}

export interface RegistryIndex {
  plugins: RegistryEntry[];
  updatedAt?: string;
}

/**
 * §260 Phase 4b — the sandboxed tier's editor surface.
 *
 * Markdown, not "content": this is a markdown editor, and the trusted tier's
 * `EditorAPI` reads flat text (`getText()`) while its `setContent` hands the string to
 * Tiptap, which parses HTML — so what you read there is not what you can write back.
 * These names say what crosses, and both directions go through the app's own round-trip
 * pipeline, so `setMarkdown(await getMarkdown())` is a no-op on the document.
 *
 * Every method is async even where the trusted tier's is sync: the editor lives in the
 * main realm, so each of these is a mediated round trip.
 */
export interface SandboxEditorAPI {
  /** The whole document as markdown. Requires `editor` or `editor:readonly`. */
  getMarkdown(): Promise<string>;
  /**
   * The selection, as ProseMirror document positions plus the text they cover.
   * Requires `editor` or `editor:readonly`.
   */
  getSelection(): Promise<{ from: number; text: string; to: number }>;
  /** Insert plain text at the cursor, as one undoable step. Requires `editor`. */
  insertText(text: string): Promise<void>;
  /** Replace the whole document, as one undoable step. Requires `editor`. */
  setMarkdown(markdown: string): Promise<void>;
}

export interface SandboxFileOptions {
  /** Registered context id to resolve `path` against. Default: the active context. */
  context?: string;
}

/**
 * §260 Phase 4a — the sandboxed tier's file API.
 *
 * Same three operations as `FilesAPI`, but `path` is **relative to a context root the
 * plugin is never told**: the host discloses no absolute path, and Rust refuses one
 * (along with `..`) outright. `""` is the context root, so `listDir("")` enumerates the
 * vault without any bootstrap path.
 *
 * `opts.context` anchors the call to a specific registered context — use the `context`
 * from a `PluginFileEvent`. Omitted, it means whichever context is active *now*.
 */
export interface SandboxFilesAPI {
  listDir(path: string, opts?: SandboxFileOptions): Promise<string[]>;
  readFile(path: string, opts?: SandboxFileOptions): Promise<string>;
  writeFile(
    path: string,
    content: string,
    opts?: SandboxFileOptions,
  ): Promise<void>;
}

/**
 * §260 Phase 4a — the sandboxed tier's UI surface: no DOM, no CSS, no element handle.
 * Everything here is data the host renders on the plugin's behalf, which is why it can
 * be offered to code the app does not trust. Arbitrary-DOM panels and injected styles
 * remain trusted-tier only (see `UIAPI`).
 */
export interface SandboxUIAPI {
  /**
   * Update one status-bar item this plugin DECLARED in `contributions.statusBar`. The
   * host resolves `id` against that declaration, so a plugin can neither invent an item
   * nor touch another plugin's.
   */
  setStatusBarText(id: string, text: string): void;
  /**
   * Show a transient toast. The host prefixes the plugin's name — a plugin must not be
   * able to render a message that reads as the app speaking — caps the length, and
   * rate-limits it, because the app has a single toast slot a plugin could otherwise
   * hold against the app's own messages.
   */
  showNotification(message: string, type?: "error" | "info" | "warning"): void;
}

export interface StatusBarItem {
  dispose(): void;
  setText(text: string): void;
}

export interface StorageAPI {
  list(): Promise<string[]>;
  read(key: string): Promise<null | string>;
  remove(key: string): Promise<void>;
  write(key: string, value: string): Promise<void>;
}

export interface TiptapExtensionDef {
  exportName: string;
  name: string;
  type: "mark" | "node" | "plugin";
}

export interface UIAPI {
  addSettingsTab(opts: PluginSettingsTabOptions): Disposable;
  addSidebarPanel(opts: PluginSidebarPanelOptions): Disposable;
  addStyle(css: string): Disposable;
  showNotification(message: string, type?: "error" | "info" | "warning"): void;
  showStatusBarItem(text: string, align?: "left" | "right"): StatusBarItem;
}

/**
 * Capabilities that admit the `ui` surface. Shared by both tiers on purpose: the
 * trusted tier hands out a `UIAPI` when a plugin holds any of these, and the sandboxed
 * tier answers `ui` requests under the same rule (§260 Phase 4a). One list, so "can this
 * plugin speak to the screen?" cannot come to two different answers.
 */
export const UI_CAPABILITIES: readonly PluginCapability[] = [
  "settings",
  "sidebar",
  "statusbar",
];

/** Human-readable descriptions for capabilities */
export const CAPABILITY_DESCRIPTIONS: Record<PluginCapability, string> = {
  editor: "문서를 읽고 수정할 수 있습니다",
  "editor:readonly": "문서 내용을 읽을 수 있습니다 (수정 불가)",
  files: "볼트 내 파일을 읽고 쓸 수 있습니다",
  "files:readonly": "볼트 내 파일을 읽을 수 있습니다 (쓰기 불가)",
  commands: "에디터 커맨드를 등록하고 실행할 수 있습니다",
  sidebar: "사이드바에 패널을 추가할 수 있습니다",
  statusbar: "상태바에 항목을 표시할 수 있습니다",
  settings: "설정 화면에 옵션을 추가할 수 있습니다",
  events: "에디터 이벤트를 수신할 수 있습니다",
  ai: "AI/LLM 기능을 사용할 수 있습니다",
  network: "네트워크 요청을 보낼 수 있습니다",
  storage: "플러그인 전용 저장소를 사용할 수 있습니다",
};
