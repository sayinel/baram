// IPC invoke 유틸리티 — Tauri 커맨드 타입 안전 래퍼
import { invoke } from "@tauri-apps/api/core";
import type {
  FileEntry,
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

// §3.2 Search commands
export async function searchFiles(
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_files", { query, options });
}

// §3.2 Index commands
export async function getBacklinks(
  filePath: string,
): Promise<BacklinkEntry[]> {
  return invoke<BacklinkEntry[]>("get_backlinks", { filePath });
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

// §6.3 LLM commands
export async function llmComplete(
  prompt: string,
  model: string,
  systemPrompt?: string,
  maxTokens?: number,
): Promise<void> {
  return invoke<void>("llm_complete", {
    prompt,
    model,
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

// §3.2 Git commands
export async function gitStatus(path: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { path });
}

export async function gitCommit(
  path: string,
  message: string,
): Promise<string> {
  return invoke<string>("git_commit", { path, message });
}

// §3.2 Snapshot commands
export async function createSnapshot(
  path: string,
  label?: string,
): Promise<SnapshotInfo> {
  return invoke<SnapshotInfo>("create_snapshot", { path, label });
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
