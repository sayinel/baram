// IPC 타입 정의 — ipc-registry.json과 동기화 유지 필수

// §3.2 Index types
export interface BacklinkEntry {
  blockId?: string; // ^blockId for block refs/embeds
  context: string;
  line: number;
  linkType?: string; // "wikilink" | "blockRef" | "blockEmbed"
  sourcePath: string;
  targetPath: string;
}

export interface ContextInfo {
  addedAt: number;
  alias?: string;
  color: string;
  contextType: ContextType;
  id: string;
  label: string;
  path: string;
  vaultType?: VaultType;
}

// §80 Context types
export type ContextType = "file" | "folder" | "vault";

export interface CustomExportItem {
  command: string;
  extension: string;
  name: string;
  showInMenu: boolean;
}

export interface DiffChange {
  content: string;
  type: "delete" | "equal" | "insert";
}

export interface DiffHunk {
  changes: DiffChange[];
  newCount: number;
  newStart: number;
  oldCount: number;
  oldStart: number;
}

export interface DiffResult {
  hunks: DiffHunk[];
  stats: DiffStats;
}

export interface DiffStats {
  additions: number;
  deletions: number;
  unchanged: number;
}

// §69 Plugin Marketplace types
export interface EngineRequirement {
  baram: string;
}

// §3.2 Export types
export type ExportFormat = "html" | "pdf";

export interface ExportOptions {
  includeYaml?: boolean;
  theme?: string;
}

// Event payloads
export interface FileChangedPayload {
  kind: "created" | "deleted" | "modified";
  path: string;
}

// §3.2 File System types
export interface FileEntry {
  isDir: boolean;
  modifiedAt: number;
  name: string;
  path: string;
  size: number;
}

export interface GitAheadBehind {
  ahead: number;
  behind: number;
}

export interface GitBranchInfo {
  is_current: boolean;
  is_remote: boolean;
  name: string;
}

// §57b Git types
export interface GitChange {
  path: string;
  staged: boolean;
  /** "modified" | "added" | "deleted" | "renamed" | "untracked" */
  status: string;
}

export interface GitDiffHunk {
  header: string;
  lines: GitDiffLine[];
}

export interface GitDiffLine {
  content: string;
  new_lineno: null | number;
  old_lineno: null | number;
  /** "+" | "-" | " " */
  origin: string;
}

export interface GitFileDiff {
  hunks: GitDiffHunk[];
  is_binary: boolean;
  path: string;
}

// §67 Git Advanced types
export interface GitLogEntry {
  author: string;
  author_email: string;
  message: string;
  oid: string;
  parent_count: number;
  short_oid: string;
  timestamp: number;
}

export interface GitRemoteInfo {
  name: string;
  url: string;
}

export interface GitStashEntry {
  index: number;
  message: string;
  oid: string;
}

export interface GitStatusInfo {
  branch: string;
  changes: GitChange[];
  is_repo: boolean;
}

export interface IndexStats {
  duration: number;
  filesIndexed: number;
  linksFound: number;
}

export interface IndexUpdatedPayload {
  duration: number;
  filesIndexed: number;
}

export interface InstalledPluginInfo {
  checksum: string;
  installPath: string;
  manifest: PluginManifest;
}

// §3.2 Config types
export type JsonValue =
  boolean | JsonValue[] | null | number | string | { [key: string]: JsonValue };

export interface LinkGraph {
  edges: Array<{ crossVault?: boolean; from: string; to: string }>;
  nodes: string[];
}

export interface LLMCompleteInput {
  // §backlog #1 — no apiKey: the backend reads the provider key from the OS keyring.
  baseUrl?: string;
  maxTokens?: number;
  model: string;
  privacyMode?: boolean;
  prompt: string;
  provider?: string;
  requestId: string;
  systemPrompt?: string;
}

export interface LLMDonePayload {
  requestId: string;
  totalTokens: number;
}

export interface LLMErrorPayload {
  error: string;
  requestId: string;
}

// §6.3 Multi-turn message type
export interface LLMMessage {
  content: string;
  role: "assistant" | "system" | "user";
}

export interface LLMTokenPayload {
  requestId: string;
  token: string;
}

export interface MergeResult {
  segments: MergeSegment[];
}

export type MergeSegment =
  | { base: string[]; external: string[]; kind: "conflict"; local: string[] }
  | { base: string[]; external: string[]; kind: "external" }
  | { base: string[]; kind: "local"; local: string[] }
  | { kind: "unchanged"; lines: string[] };

// §6.3 LLM types
export interface ModelInfo {
  id: string;
  name: string;
}

// §61 Namespace rename result
export interface NamespaceRenameResult {
  filesMoved: number;
  updatedFiles: string[];
}

/** A binary asset (e.g. rasterized Mermaid PNG) sent alongside a Pandoc
 *  export. `data` is raw bytes as a number array (no base64 dependency). */
export interface PandocAsset {
  /** Raw file bytes */
  data: number[];
  /** File name written next to the Pandoc input, e.g. "mermaid-0.png" */
  name: string;
}

// §55 Pandoc Extended Export types
export type PandocFormat = "docx" | "epub" | "latex" | "rst";

export interface PandocInfo {
  available: boolean;
  path: string;
  version: string;
}

// §5.10 PDF export options (headless Chrome backend)
export interface PdfOptions {
  landscape?: boolean;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  marginTop?: number; // inches
  paperSize?: "a4" | "letter";
  printBackground?: boolean;
  scale?: number;
}

export interface PluginManifest {
  author: string;
  capabilities: string[];
  dependencies: string[];
  description: string;
  engines: EngineRequirement;
  id: string;
  license: string;
  main: string;
  name: string;
  repository?: string;
  tiptapExtensions: TiptapExtensionDef[];
  version: string;
}

// §82 Native "Open Recent" submenu payload (frontend → update_recent_menu)
export interface RecentMenuEntry {
  enabled?: boolean; // default true; false for non-clickable group headers
  icon?: string; // e.g. "vault" → native menu renders a distinguishing icon
  id?: string; // present for kind:"item"; "recent_folder:<path>" | "recent_file:<path>" | "recent_clear"
  kind: "item" | "separator";
  label?: string; // present for kind:"item"
}

export interface RegistryEntry {
  author: string;
  capabilities: string[];
  checksum: string;
  description: string;
  downloadUrl: string;
  id: string;
  license: string;
  name: string;
  version: string;
}

export interface RegistryIndex {
  plugins: RegistryEntry[];
  updatedAt?: string;
}

// §33 Rename result
export interface RenameResult {
  updatedFiles: string[];
}

export interface RenameTagResult {
  filesModified: number;
  occurrencesReplaced: number;
}

/** §86 Flat merged settings: global → vault → (future) frontmatter. */
export interface ResolvedSettings {
  aiContextScope?: string;
  aiModel?: string;
  aiPrivacyMode?: boolean;
  dailyNotesFolder?: string;
  defaultNewFileLocation?: string;
  enableMermaid?: boolean;
  enableWikilink?: boolean;
  extensionsDisabled?: string[];
  extensionsEnabled?: string[];
  gitAutoFetchInterval?: number;
  gitAutoPushOnCommit?: boolean;
  markdownSerializationRules?: Record<string, unknown>;
  skillsFolder?: string;
  snapshotIntervalMinutes?: number;
  snapshotMaxCount?: number;
  themeOverride?: string;
}

// §3.2 Search types
export interface SearchOptions {
  caseSensitive?: boolean;
  excludeGlob?: string;
  includeGlob?: string;
  maxResults?: number;
  regex?: boolean;
  wholeWord?: boolean;
}

export interface SearchResult {
  column: number;
  filePath: string;
  line: number;
  snippet: string;
}

export interface SnapshotEntry {
  files: SnapshotFileEntry[];
  id: string;
  label: null | string;
  timestamp: string; // ISO 8601
  totalSizeBytes: number;
  type: "auto" | "manual";
}

// §71 Snapshot types
export interface SnapshotFileEntry {
  checksum: string;
  path: string;
  sizeBytes: number;
}
// §56m Tag types
export interface TagEntry {
  count: number;
  tag: string;
}

export interface TiptapExtensionDef {
  exportName: string;
  name: string;
  type: string; // "node" | "mark" | "plugin"
}

// §34 Unlinked Mentions
export interface UnlinkedMention {
  context: string;
  line: number;
  matchText: string;
  sourcePath: string;
}

export interface VaultConfig {
  ai?: { contextScope?: string; model?: string; privacyMode?: boolean };
  appearance?: { theme?: string };
  crossVaultHints?: Record<string, { lastKnownPath: string }>;
  editor?: {
    dailyNotesFolder?: string;
    defaultNewFileLocation?: string;
    skillsFolder?: string;
  };
  extensions?: { disabled?: string[]; enabled?: string[] };
  git?: { autoFetchInterval?: number; autoPushOnCommit?: boolean };
  markdown?: {
    enableMermaid?: boolean;
    enableWikilink?: boolean;
    serializationRules?: Record<string, unknown>;
  };
  snapshot?: { intervalMinutes?: number; maxCount?: number };
  vault?: { alias: string; type: string };
  workLog?: {
    enabled?: boolean;
    fileNameFormat?: string;
    folder?: string;
    template?: string;
  };
  zettelkasten?: { favorites?: string[] };
}

export type VaultType = "general" | "journal" | "zettelkasten";
