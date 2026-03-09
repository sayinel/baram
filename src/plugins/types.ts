// §69 Plugin Marketplace — Core Types

export type PluginCapability =
  | "editor" | "editor:readonly" | "files" | "files:readonly"
  | "commands" | "sidebar" | "statusbar" | "settings"
  | "events" | "ai" | "network";

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  main: string;
  engines: { baram: string };
  capabilities: PluginCapability[];
  dependencies?: string[];
  tiptapExtensions?: TiptapExtensionDef[];
  repository?: string;
  homepage?: string;
  icon?: string;
  keywords?: string[];
}

export interface TiptapExtensionDef {
  type: "node" | "mark" | "plugin";
  name: string;
  exportName: string;
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  installPath: string;
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  checksum: string;
}

export interface RegistryEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  downloadUrl: string;
  checksum: string;
  capabilities: PluginCapability[];
  keywords?: string[];
  downloads?: number;
  repository?: string;
  homepage?: string;
  icon?: string;
  engines: { baram: string };
}

export interface RegistryIndex {
  plugins: RegistryEntry[];
  updatedAt?: string;
}

export interface Disposable {
  dispose(): void;
}

export interface LoadedPlugin {
  id: string;
  manifest: PluginManifest;
  module: PluginModule;
  context: ExtensionContext;
  disposables: Disposable[];
}

export interface PluginModule {
  activate?(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
  [key: string]: unknown;
}

export interface ExtensionContext {
  pluginId: string;
  pluginPath: string;
  subscriptions: Disposable[];
  commands: CommandsAPI;
  editor: EditorAPI;
  files: FilesAPI;
  events: EventsAPI;
  ui: UIAPI;
}

export interface CommandsAPI {
  register(id: string, handler: (...args: unknown[]) => unknown): Disposable;
  execute(id: string, ...args: unknown[]): Promise<unknown>;
}

export interface EditorAPI {
  getContent(): string;
  setContent(content: string): void;
  getSelection(): { from: number; to: number; text: string };
  insertText(text: string): void;
}

export interface FilesAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
}

export interface EventsAPI {
  on(event: string, handler: (...args: unknown[]) => void): Disposable;
  emit(event: string, ...args: unknown[]): void;
}

export interface UIAPI {
  showNotification(message: string, type?: "info" | "warning" | "error"): void;
  showStatusBarItem(text: string, alignment?: "left" | "right"): Disposable;
}

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
};
