// IPC 타입 정의 — ipc-registry.json과 동기화 유지 필수

// §3.2 File System types
export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;
}

// §3.2 Search types
export interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regex?: boolean;
  maxResults?: number;
  includeGlob?: string;
  excludeGlob?: string;
}

export interface SearchResult {
  filePath: string;
  line: number;
  column: number;
  snippet: string;
}

// §3.2 Index types
export interface BacklinkEntry {
  sourcePath: string;
  targetPath: string;
  context: string;
  line: number;
  linkType?: string;   // "wikilink" | "blockRef" | "blockEmbed"
  blockId?: string;    // ^blockId for block refs/embeds
}

export interface LinkGraph {
  nodes: string[];
  edges: Array<{ from: string; to: string }>;
}

export interface IndexStats {
  filesIndexed: number;
  linksFound: number;
  duration: number;
}

// §34 Unlinked Mentions
export interface UnlinkedMention {
  sourcePath: string;
  line: number;
  context: string;
  matchText: string;
}

// §57b Git types
export interface GitChange {
  path: string;
  /** "modified" | "added" | "deleted" | "renamed" | "untracked" */
  status: string;
  staged: boolean;
}

export interface GitStatusInfo {
  branch: string;
  changes: GitChange[];
  is_repo: boolean;
}

export interface GitDiffLine {
  /** "+" | "-" | " " */
  origin: string;
  content: string;
  old_lineno: number | null;
  new_lineno: number | null;
}

export interface GitDiffHunk {
  header: string;
  lines: GitDiffLine[];
}

export interface GitFileDiff {
  path: string;
  hunks: GitDiffHunk[];
  is_binary: boolean;
}

export interface GitBranchInfo {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}

// §67 Git Advanced types
export interface GitLogEntry {
  oid: string;
  short_oid: string;
  message: string;
  author: string;
  author_email: string;
  timestamp: number;
  parent_count: number;
}

export interface GitStashEntry {
  index: number;
  message: string;
  oid: string;
}

export interface GitRemoteInfo {
  name: string;
  url: string;
}

export interface GitAheadBehind {
  ahead: number;
  behind: number;
}

// §6.3 LLM types
export interface ModelInfo {
  id: string;
  name: string;
}

export interface LLMCompleteInput {
  apiKey: string;
  prompt: string;
  model: string;
  requestId: string;
  systemPrompt?: string;
  maxTokens?: number;
  provider?: string;
  baseUrl?: string;
  privacyMode?: boolean;
}

// §6.3 Multi-turn message type
export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

// §3.2 Export types
export type ExportFormat = "pdf" | "html";

export interface ExportOptions {
  includeYaml?: boolean;
  theme?: string;
}

// §55 Pandoc Extended Export types
export type PandocFormat = "docx" | "latex" | "epub" | "rst";

export interface PandocInfo {
  path: string;
  version: string;
  available: boolean;
}

export interface CustomExportItem {
  name: string;
  command: string;
  extension: string;
  showInMenu: boolean;
}

// §5.10 PDF export options (headless Chrome backend)
export interface PdfOptions {
  paperSize?: "a4" | "letter";
  landscape?: boolean;
  printBackground?: boolean;
  scale?: number;
  marginTop?: number; // inches
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
}

// §3.2 Config types
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

// §33 Rename result
export interface RenameResult {
  updatedFiles: string[];
}

// §56m Tag types
export interface TagEntry {
  tag: string;
  count: number;
}

export interface RenameTagResult {
  filesModified: number;
  occurrencesReplaced: number;
}

// §71 Snapshot types
export interface SnapshotFileEntry {
  path: string;
  checksum: string;
  sizeBytes: number;
}

export interface SnapshotEntry {
  id: string;
  timestamp: string;        // ISO 8601
  type: "auto" | "manual";
  label: string | null;
  files: SnapshotFileEntry[];
  totalSizeBytes: number;
}

export interface DiffChange {
  type: "equal" | "delete" | "insert";
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  changes: DiffChange[];
}

export interface DiffStats {
  additions: number;
  deletions: number;
  unchanged: number;
}

export interface DiffResult {
  hunks: DiffHunk[];
  stats: DiffStats;
}

// Event payloads
export interface FileChangedPayload {
  path: string;
  kind: "modified" | "created" | "deleted";
}

export interface LLMTokenPayload {
  requestId: string;
  token: string;
}

export interface LLMDonePayload {
  requestId: string;
  totalTokens: number;
}

export interface LLMErrorPayload {
  requestId: string;
  error: string;
}

export interface IndexUpdatedPayload {
  filesIndexed: number;
  duration: number;
}
