// IPC 타입 정의 — ipc-registry.json과 동기화 유지 필수

/** §312 아카이브로 옮길 줄 하나 — 인덱스의 `TaskEntry`에서 그대로 뽑는다. */
export interface ArchiveItem {
  expectedRaw: string;
  line: number;
  path: string;
}

/**
 * §312 아카이브 실행 회계. 넷을 합치지 않는 이유는 §309 배치와 같다 — `stale`은 정상
 * 경합이고 `failed`는 사고다.
 */
export interface ArchiveOutcome {
  /** 실제로 옮겨진 줄 수 */
  archived: number;
  /** I/O 실패로 옮기지 못한 줄 */
  failed: number;
  /** 바이트가 바뀐 파일 전부(원본 + 대상) — 호출자가 이만큼만 다시 읽는다 */
  paths: string[];
  /** 자격 미달로 그냥 둔 줄 — 경과일 미달, `✅` 없음, 들여쓴 항목, 이미 제자리 */
  skipped: number;
  /** 그 사이 파일이 바뀌어 건너뛴 줄 */
  stale: number;
}

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
  repo_root: null | string;
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

// §69 — this file used to declare its own `RegistryEntry`, `RegistryIndex`,
// `PluginManifest`, `EngineRequirement` and `TiptapExtensionDef`, all imported by nobody:
// `plugin-invoke.ts` and the plugin code have always taken them from
// `src/plugins/types.ts`. Removed rather than updated alongside the optional `engines`,
// because a second copy left behind is worse than no copy — the next person to relax a
// registry field would have had two plausible declarations and no way to tell which one
// runs. They had ALREADY drifted: this `PluginManifest` never gained `trust`, the field
// §260's whole tier model turns on.
//
// `knip.json` ignores `src/ipc/**`, so nothing was ever going to report any of it. That
// ignore rule is the reason five dead types accumulated here; it deserves its own pass.

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

// §82 Native "Open Recent" submenu payload (frontend → update_recent_menu)
export interface RecentMenuEntry {
  enabled?: boolean; // default true; false for non-clickable group headers
  id?: string; // present for kind:"item"; "recent_folder:<path>" | "recent_file:<path>" | "recent_clear"
  kind: "item" | "separator";
  label?: string; // present for kind:"item"
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

export interface TaskEntry {
  cancelled: null | string;
  created: null | string;
  done: null | string;
  due: null | string;
  indent: number;
  line: number;
  links: string[];
  path: string;
  priority: number;
  /** 줄 원문 — §305 낙관적 잠금의 비교 기준 */
  raw: string;
  recurrence: null | string;
  scheduled: null | string;
  start: null | string;
  state: TaskState;
  tags: string[];
  text: string;
}

// §304 Task types
//
// §18.18 M4 widened this from `todo | done`. `doing` and `cancelled` are not
// GFM — a viewer that does not know them shows `[/]` and `[-]` as text rather
// than a checkbox, which the design accepted as the price of having them.
//
// ‼️ Neither new state is a kind of "done". Anything asking "is this finished"
// must test `=== "done"`, never `!== "todo"`, or a cancelled task starts
// counting as completed work.
export type TaskState = "cancelled" | "doing" | "done" | "todo";

/** The marker each state is written as, and read back from. */
export const TASK_STATE_MARKER: Record<TaskState, string> = {
  cancelled: "-",
  doing: "/",
  done: "x",
  todo: " ",
};

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
  fileTree?: {
    sortOrder?: string;
  };
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
