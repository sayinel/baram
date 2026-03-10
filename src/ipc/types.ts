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

// §3.2 Export types
export type ExportFormat = "html" | "pdf";

export interface ExportOptions {
  includeYaml?: boolean;
  theme?: string;
}

// §69 Plugin Marketplace types
export interface EngineRequirement {
  baram: string;
}

export interface TiptapExtensionDef {
  type: string; // "node" | "mark" | "plugin"
  name: string;
  exportName: string;
}

export interface PluginManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  license: string;
  main: string;
  engines: EngineRequirement;
  capabilities: string[];
  dependencies: string[];
  tiptapExtensions: TiptapExtensionDef[];
  repository?: string;
}

export interface InstalledPluginInfo {
  manifest: PluginManifest;
  installPath: string;
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
  capabilities: string[];
}

export interface RegistryIndex {
  plugins: RegistryEntry[];
  updatedAt?: string;
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

// §3.2 Config types
export type JsonValue =
  | boolean
  | JsonValue[]
  | null
  | number
  | string
  | { [key: string]: JsonValue };

export interface LinkGraph {
  edges: Array<{ from: string; to: string }>;
  nodes: string[];
}

export interface LLMCompleteInput {
  apiKey: string;
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

// §33 Rename result
export interface RenameResult {
  updatedFiles: string[];
}

export interface RenameTagResult {
  filesModified: number;
  occurrencesReplaced: number;
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

// §34 Unlinked Mentions
export interface UnlinkedMention {
  context: string;
  line: number;
  matchText: string;
  sourcePath: string;
}
