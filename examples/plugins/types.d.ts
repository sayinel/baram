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
    /** §260 Phase 4c — the user's answers to `contributions.settings`. Read-only. */
    settings: SettingsAPI;
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
    /**
     * §260 Phase 5 — the (trust, capabilities) the user approved at install, kept so a
     * later version can be compared against what was actually agreed to rather than
     * against the manifest that shipped with it. Absent for dev-folder plugins (choosing
     * a directory is its own deliberate act) and for records written before Phase 5.
     */
    consent?: PluginConsent;
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
 * §260 Phase 5 — a snapshot of what the user approved, taken at the moment they
 * approved it. Compared against a later version's request by `plugin-consent.ts`.
 */
export interface PluginConsent {
    /** Exactly what was shown, so a later diff is against the displayed list. */
    capabilities: PluginCapability[];
    trust: PluginTrust;
}
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
    settings?: PluginSettingField[];
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
/**
 * §260 Phase 4c — one declared settings field. The manifest asks the question; the user's
 * answer is host-owned (see `plugin-settings.ts`), and a plugin only ever READS it.
 *
 * No range, pattern or enum in v1 — a `number` field is any finite number. A plugin that
 * needs a bounded value validates it itself, which it must do anyway: the persisted record
 * is a config file the user can edit.
 */
export interface PluginSettingField {
    default?: PluginSettingValue;
    key: string;
    label: string;
    type: PluginSettingType;
}
export interface PluginSettingsTabOptions {
    id: string;
    onMount(el: HTMLElement): void;
    onUnmount?(el: HTMLElement): void;
    title: string;
}
export type PluginSettingType = (typeof SETTING_TYPES)[number];
/** What a resolved setting can be — one per `SETTING_TYPES` member. */
export type PluginSettingValue = boolean | number | string;
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
/**
 * What a sandboxed plugin's `activate` receives — the sandboxed tier's counterpart to
 * `ExtensionContext`.
 *
 * ‼️ Per-member notes go INSIDE the member's doc comment. `perfectionist` sorts these
 * members on every lint run, and a bare `//` block between two of them stays put while the
 * member it described moves away — which already happened once here, leaving the 3c-1
 * broker note sitting above `editor`. The same rule is written at the top of `protocol.ts`
 * for the same reason.
 *
 * §260 3c-1 — the BROKERED members (`files`, `network`, `storage`) are routed through
 * `broker` (= `plugin_call` in production) and exposed unconditionally: the Rust
 * authorizer, keyed on the Tauri-verified `window.label()`, is the real per-call capability
 * gate, so an op for an unregistered capability fails closed there rather than here. The
 * HOST-MEDIATED members (`ai`, `editor`, `ui`) are gated in the main realm instead, because
 * their policy or their subject lives there.
 *
 * §260 Phase 6 — declared HERE rather than beside the client runtime, so plugin authors can
 * name it: `public-api.ts` re-exports only from this module, and pulling it from
 * `sandbox-client.ts` would drag the internal transport/protocol declarations into the
 * published `examples/plugins` surface. Its siblings (`SandboxEditorAPI`, `SandboxUIAPI`,
 * …) were always here.
 */
export interface SandboxContext {
    /**
     * §260 3c-2c — host-mediated, NOT brokered in Rust: the model, provider and
     * privacy-mode decisions live in the main realm, and the request carries none of
     * them. The `ai` capability is checked host-side, which is enforcing because a
     * `plugin-*` window holds no `llm_*` ACL grant.
     */
    ai: AIAPI;
    commands: {
        register(id: string, handler: (...args: unknown[]) => unknown): void;
    };
    /**
     * §260 Phase 4b — the document, mediated by the host (it lives in the main realm). A
     * read arrives as a STAGED payload pulled through the broker rather than in the response
     * frame; `getMarkdown` hides that round trip.
     */
    editor: SandboxEditorAPI;
    events: {
        emit(event: string, ...args: unknown[]): void;
        /**
         * §260 Phase 4a — overloaded so the file events' payload actually reaches plugin
         * code as `PluginFileEvent` (code review nit): with only the `unknown[]` signature an
         * author had to cast to learn the shape of the very thing this phase added.
         */
        on(event: "file:open" | "file:save", handler: (file: PluginFileEvent) => void): void;
        on(event: string, handler: (...args: unknown[]) => void): void;
    };
    files: SandboxFilesAPI;
    network: NetworkAPI;
    /**
     * §260 Phase 4c — the values the user set for this plugin's declared fields. Read-only
     * and host-mediated: the record is the app's, and `settings:changed` (delivered without a
     * payload) is the signal to read it again.
     */
    settings: SandboxSettingsAPI;
    storage: StorageAPI;
    /**
     * §260 Phase 4a — data-only UI: the host renders on this plugin's behalf, so there is
     * no DOM or CSS here (that is the trusted tier's `UIAPI`). Host-mediated like `ai`,
     * and gated there — attribution, sanitising and rate limiting cannot be enforced in
     * this realm.
     */
    ui: SandboxUIAPI;
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
    getSelection(): Promise<{
        from: number;
        text: string;
        to: number;
    }>;
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
    writeFile(path: string, content: string, opts?: SandboxFileOptions): Promise<void>;
}
/**
 * §260 Phase 4c — the sandboxed tier's settings surface: read-only, and asynchronous
 * because the values live in the main realm.
 *
 * There is no `set`. A setting is the user's answer to a question this plugin's manifest
 * asked; a plugin that could write one could silently undo a choice the user made, with
 * nothing in the UI showing that it moved. Use `storage` for state of your own.
 */
export interface SandboxSettingsAPI {
    /**
     * Every field declared in `contributions.settings`, with its current value — always of
     * the declared type, and never a key the manifest does not declare. Requires the
     * `settings` capability.
     *
     * Subscribe to `"settings:changed"` through `events.on` to learn when to call this again;
     * that notification carries no values, so re-reading is how a plugin sees them.
     */
    getAll(): Promise<Record<string, PluginSettingValue>>;
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
/**
 * §260 Phase 4c — the trusted tier's settings surface. Synchronous, because the store is
 * in this realm; otherwise identical to `SandboxSettingsAPI`, resolved by the same
 * function, so one plugin source can serve both tiers.
 *
 * Read-only for the same reason as the sandboxed tier: the value is the user's answer, not
 * the plugin's state. A trusted plugin can of course reach the store itself — this is the
 * portable spelling, not a boundary.
 */
export interface SettingsAPI {
    getAll(): Record<string, PluginSettingValue>;
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
/**
 * Capabilities that admit reading the document, and those that admit writing it.
 *
 * Same rule and same reason as `UI_CAPABILITIES` (§260 Phase 4b code review, M1): the
 * trusted tier hands out a read-only or read-write `EditorAPI` from these, and the
 * sandboxed tier gates its `editor` requests on them, so "may this plugin read the
 * document?" cannot come to two different answers in two files.
 */
export declare const EDITOR_READ_CAPABILITIES: readonly PluginCapability[];
export declare const EDITOR_WRITE_CAPABILITIES: readonly PluginCapability[];
/**
 * The types a settings field may declare (§260 Phase 4c).
 *
 * A `const` array rather than a bare union because three separate places need to branch on
 * the SAME set: the validator (is this `type` legal?), the form (which control to render),
 * and the resolver (`typeof value === type`). That last one is why the members are spelled
 * exactly as `typeof` returns them — the resolver compares against `typeof` directly, so a
 * friendlier name here ("text", "toggle") would need a mapping table whose two halves could
 * drift.
 */
export declare const SETTING_TYPES: readonly ["boolean", "number", "string"];
/** Human-readable descriptions for capabilities */
export declare const CAPABILITY_DESCRIPTIONS: Record<PluginCapability, string>;
