// §69 Plugin Marketplace — Core Types

export interface CommandsAPI {
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  register(id: string, handler: (...args: unknown[]) => unknown): Disposable;
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
  commands: CommandsAPI;
  editor: EditorAPI;
  events: EventsAPI;
  files: FilesAPI;
  pluginId: string;
  pluginPath: string;
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
  | "statusbar";

export interface PluginManifest {
  author: string;
  capabilities: PluginCapability[];
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
  version: string;
}

export interface PluginModule {
  [key: string]: unknown;
  activate?(context: ExtensionContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

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
  version: string;
}

export interface RegistryIndex {
  plugins: RegistryEntry[];
  updatedAt?: string;
}

export interface TiptapExtensionDef {
  exportName: string;
  name: string;
  type: "mark" | "node" | "plugin";
}

export interface UIAPI {
  showNotification(message: string, type?: "error" | "info" | "warning"): void;
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
