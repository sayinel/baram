export interface AIAPI {
    complete(prompt: string, opts?: AICompleteOptions): Promise<string>;
    listModels(): Promise<AIModel[]>;
    stream(prompt: string, opts: AICompleteOptions, onToken: (token: string) => void): Promise<void>;
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
    register(id: string, handler: (...args: unknown[]) => unknown, opts?: CommandRegisterOptions): Disposable;
}
export interface Disposable {
    dispose(): void;
}
export interface EditorAPI {
    getContent(): string;
    getSelection(): {
        from: number;
        text: string;
        to: number;
    };
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
export type PluginCapability = "ai" | "commands" | "editor" | "editor:readonly" | "events" | "files" | "files:readonly" | "network" | "settings" | "sidebar" | "statusbar" | "storage" | "viewer";
/**
 * §260 declarative contribution surface for sandboxed plugins. Populated in
 * the manifest; consumed by the sandbox runtime in later phases. Every field
 * is serializable (crosses the plugin/host boundary as data).
 */
export interface PluginContributions {
    commands?: Array<{
        id: string;
        palette?: boolean;
        title: string;
    }>;
    menu?: Array<{
        command: string;
        id: string;
        title: string;
        when?: string;
    }>;
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
/**
 * What the host tells a file viewer when it mounts or updates. `assetUrl` is
 * the file served over the asset: protocol, already cache-busted with
 * `refreshKey` — a viewer that just needs to display the file never touches
 * the filesystem APIs.
 */
export interface PluginFileViewerContext {
    assetUrl: string;
    filePath: string;
    /** Bumped on every save / external reload — re-fetch the file when it changes. */
    refreshKey: number;
    /**
     * Shared editor zoom factor (0.5–2.0) driven by useZoom (Cmd+= / Cmd+- /
     * Cmd+0, Ctrl+wheel, pinch). The host container does NOT apply CSS zoom to
     * viewer content — scaling is the viewer's job, with this value.
     */
    zoomLevel: number;
}
/**
 * A custom read-only renderer for file extensions the core editor does not
 * handle itself. Registered via `ui.registerFileViewer` (capability
 * "viewer"). For text files the host keeps its preview ↔ source toggle: the
 * viewer renders the preview side, CodeMirror the source side. Binary
 * safety (skipping UTF-8 reads, blocking saves) stays in the host — a viewer
 * only ever draws.
 */
export interface PluginFileViewerOptions {
    /** Extensions without the leading dot, lowercase (e.g. ["png", "svg"]). */
    extensions: string[];
    id: string;
    onMount(el: HTMLElement, ctx: PluginFileViewerContext): void;
    onUnmount?(el: HTMLElement): void;
    /** Called when ctx changes (zoom / refresh) while mounted. */
    onUpdate?(el: HTMLElement, ctx: PluginFileViewerContext): void;
}
export interface PluginManifest {
    author: string;
    capabilities: PluginCapability[];
    contributions?: PluginContributions;
    dependencies?: string[];
    description: string;
    engines: {
        baram: string;
    };
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
export type PluginStatus = "disabled" | "enabled" | "installing" | "not-installed";
export type PluginTrust = "sandboxed" | "trusted";
export interface RegistryEntry {
    author: string;
    capabilities: PluginCapability[];
    checksum: string;
    description: string;
    downloads?: number;
    downloadUrl: string;
    engines: {
        baram: string;
    };
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
    writeFile(path: string, content: string, opts?: SandboxFileOptions): Promise<void>;
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
    registerFileViewer(opts: PluginFileViewerOptions): Disposable;
    showNotification(message: string, type?: "error" | "info" | "warning"): void;
    showStatusBarItem(text: string, align?: "left" | "right"): StatusBarItem;
}
/**
 * Capabilities that admit the `ui` surface. Shared by both tiers on purpose: the
 * trusted tier hands out a `UIAPI` when a plugin holds any of these, and the sandboxed
 * tier answers `ui` requests under the same rule (§260 Phase 4a). One list, so "can this
 * plugin speak to the screen?" cannot come to two different answers.
 */
export declare const UI_CAPABILITIES: readonly PluginCapability[];
/** Human-readable descriptions for capabilities */
export declare const CAPABILITY_DESCRIPTIONS: Record<PluginCapability, string>;
