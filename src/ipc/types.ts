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

// §3.2 Git types
export interface GitStatus {
  branch: string;
  modified: string[];
  staged: string[];
  untracked: string[];
}

// §6.3 LLM types
export interface LLMCompleteInput {
  apiKey: string;
  prompt: string;
  model: string;
  requestId: string;
  systemPrompt?: string;
  maxTokens?: number;
}

// §3.2 Export types
export type ExportFormat = "pdf" | "html";

export interface ExportOptions {
  includeYaml?: boolean;
  theme?: string;
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

// §3.2 Snapshot types
export interface SnapshotInfo {
  id: string;
  path: string;
  label: string;
  createdAt: number;
}

// §33 Rename result
export interface RenameResult {
  updatedFiles: string[];
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
