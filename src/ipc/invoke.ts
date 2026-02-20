// IPC invoke 유틸리티 — Tauri 커맨드 타입 안전 래퍼
import { invoke } from "@tauri-apps/api/core";
import type {
  FileEntry,
  UnlinkedMention,
  SearchOptions,
  SearchResult,
  BacklinkEntry,
  LinkGraph,
  IndexStats,
  GitStatus,
  ExportFormat,
  ExportOptions,
  PdfOptions,
  JsonValue,
  SnapshotInfo,
  RenameResult,
} from "./types";

// §3.2 File System commands
export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

export async function writeFile(
  path: string,
  content: string,
): Promise<void> {
  return invoke<void>("write_file", { path, content });
}

export async function listDir(
  path: string,
  recursive?: boolean,
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_dir", { path, recursive });
}

export async function renameFile(from: string, to: string): Promise<void> {
  return invoke<void>("rename_file", { from, to });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke<void>("delete_file", { path });
}

export async function watchDir(path: string): Promise<void> {
  return invoke<void>("watch_dir", { path });
}

// §3.2 Search commands — TODO: Rust handler not yet implemented (M7 search)
export async function searchFiles(
  _query: string,
  _options?: SearchOptions,
): Promise<SearchResult[]> {
  console.warn("[IPC] search_files not yet implemented");
  return [];
}

// §3.2 Index commands
export async function getBacklinks(
  filePath: string,
): Promise<BacklinkEntry[]> {
  return invoke<BacklinkEntry[]>("get_backlinks", { filePath });
}

// §34 Unlinked Mentions
export async function getUnlinkedMentions(
  filePath: string,
  rootPath: string,
): Promise<UnlinkedMention[]> {
  return invoke<UnlinkedMention[]>("get_unlinked_mentions", { filePath, rootPath });
}

export async function getLinkIndex(): Promise<LinkGraph> {
  return invoke<LinkGraph>("get_link_index");
}

export async function refreshIndex(rootPath: string): Promise<IndexStats> {
  return invoke<IndexStats>("refresh_index", { rootPath });
}

export async function updateFileIndex(filePath: string): Promise<void> {
  return invoke<void>("update_file_index", { filePath });
}

// §33 Rename file with wikilink auto-update
export async function renameFileWithLinks(
  oldPath: string,
  newPath: string,
): Promise<RenameResult> {
  return invoke<RenameResult>("rename_file_with_links", { oldPath, newPath });
}

// §30a Rename block ID with reference auto-update
export async function renameBlockId(
  filePath: string,
  oldId: string,
  newId: string,
): Promise<RenameResult> {
  return invoke<RenameResult>("rename_block_id", { filePath, oldId, newId });
}

// §6.3 LLM commands
export async function llmComplete(
  apiKey: string,
  prompt: string,
  model: string,
  requestId: string,
  systemPrompt?: string,
  maxTokens?: number,
): Promise<void> {
  return invoke<void>("llm_complete", {
    apiKey,
    prompt,
    model,
    requestId,
    systemPrompt,
    maxTokens,
  });
}

// §3.2 Export commands
export async function exportDocument(
  path: string,
  format: ExportFormat,
  options?: ExportOptions,
): Promise<string> {
  return invoke<string>("export_document", { path, format, options });
}

// §5.10 PDF export via headless Chrome
export async function exportPdf(
  htmlContent: string,
  outputPath: string,
  options?: PdfOptions,
): Promise<void> {
  return invoke<void>("export_pdf", { htmlContent, outputPath, options });
}

// §3.2 Git commands — TODO: Rust handler not yet implemented (M9)
export async function gitStatus(_path: string): Promise<GitStatus> {
  console.warn("[IPC] git_status not yet implemented");
  return { branch: "", modified: [], staged: [], untracked: [] };
}

export async function gitCommit(
  _path: string,
  _message: string,
): Promise<string> {
  console.warn("[IPC] git_commit not yet implemented");
  return "";
}

// §3.2 Snapshot commands — TODO: Rust handler not yet implemented (M9)
export async function createSnapshot(
  _path: string,
  _label?: string,
): Promise<SnapshotInfo> {
  console.warn("[IPC] create_snapshot not yet implemented");
  return { id: "", path: "", label: "", createdAt: 0 };
}

// macOS file association: get pending file paths from cold start
export async function getOpenedUrls(): Promise<string[]> {
  return invoke<string[]>("get_opened_urls");
}

// §3.2 Config commands
export async function getConfig(key?: string): Promise<JsonValue> {
  return invoke<JsonValue>("get_config", { key });
}

export async function setConfig(
  key: string,
  value: JsonValue,
): Promise<void> {
  return invoke<void>("set_config", { key, value });
}
