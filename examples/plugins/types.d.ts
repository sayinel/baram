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
    context: ExtensionContext;
    disposables: Disposable[];
    id: string;
    manifest: PluginManifest;
    module: PluginModule;
}
export interface NetworkAPI {
    fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResponse>;
}
export type PluginCapability = "ai" | "commands" | "editor" | "editor:readonly" | "events" | "files" | "files:readonly" | "network" | "settings" | "sidebar" | "statusbar" | "storage";
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
export interface PluginManifest {
    author: string;
    capabilities: PluginCapability[];
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
    version: string;
}
export interface RegistryIndex {
    plugins: RegistryEntry[];
    updatedAt?: string;
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
/** Human-readable descriptions for capabilities */
export declare const CAPABILITY_DESCRIPTIONS: Record<PluginCapability, string>;
