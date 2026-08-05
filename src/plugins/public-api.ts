// §69 Plugin public API — type-only re-export barrel (single source of truth).
// Generated into examples/plugins/plugin-api.d.ts via `npm run types:plugin`.
// Type-only: verbatimModuleSyntax requires `export type`.
export type {
  AIAPI,
  AICompleteOptions,
  AIModel,
  CommandRegisterOptions,
  CommandsAPI,
  Disposable,
  EditorAPI,
  EventsAPI,
  ExtensionContext,
  FilesAPI,
  NetworkAPI,
  PluginCapability,
  PluginEventName,
  PluginFetchInit,
  PluginFetchResponse,
  // §260 Phase 6 — the sandboxed tier's payload for `file:open`/`file:save`; the only way
  // that tier learns a path at all.
  PluginFileEvent,
  PluginFileViewerContext,
  PluginFileViewerOptions,
  PluginManifest,
  PluginSettingField,
  PluginSettingsTabOptions,
  PluginSettingValue,
  PluginSidebarPanelOptions,
  PluginTrust,
  // §260 Phase 6 — the SANDBOXED tier's context and surfaces. Published because that tier
  // is the default one: without `SandboxContext` an author writing `activate(ctx)` for a
  // sandboxed plugin has no type to name, which is how the reference port was blocked.
  SandboxContext,
  SandboxEditorAPI,
  SandboxFileOptions,
  SandboxFilesAPI,
  SandboxSettingsAPI,
  SandboxUIAPI,
  StatusBarItem,
  StorageAPI,
  TiptapExtensionDef,
  UIAPI,
} from "./types";
