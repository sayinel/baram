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
  GitStatusInfo,
  GitFileDiff,
  GitBranchInfo,
  ExportFormat,
  ExportOptions,
  PdfOptions,
  PandocInfo,
  RenameResult,
  ModelInfo,
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

export async function createDir(path: string): Promise<void> {
  return invoke<void>("create_dir", { path });
}

export async function deleteDir(path: string): Promise<void> {
  return invoke<void>("delete_dir", { path });
}

export async function copyFile(from: string, to: string): Promise<void> {
  return invoke<void>("copy_file", { from, to });
}

export async function watchDir(path: string): Promise<void> {
  return invoke<void>("watch_dir", { path });
}

/** §56d Write binary data to a file (for images, etc.) */
export async function writeBinaryFile(path: string, data: number[]): Promise<void> {
  return invoke<void>("write_binary_file", { path, data });
}

/** §53 Extract a ZIP file to output directory, returns list of extracted file paths */
export async function extractZip(
  zipPath: string,
  outputDir: string,
): Promise<string[]> {
  return invoke<string[]>("extract_zip", { zipPath, outputDir });
}

// §5.11 Global Search
export async function searchFiles(
  rootPath: string,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_files", { rootPath, query, options });
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
export async function llmListModels(
  provider: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("llm_list_models", { provider, apiKey, baseUrl });
}

export async function llmComplete(
  apiKey: string,
  prompt: string,
  model: string,
  requestId: string,
  systemPrompt?: string,
  maxTokens?: number,
  provider?: string,
  baseUrl?: string,
  privacyMode?: boolean,
): Promise<void> {
  return invoke<void>("llm_complete", {
    apiKey,
    prompt,
    model,
    requestId,
    systemPrompt,
    maxTokens,
    provider,
    baseUrl,
    privacyMode,
  });
}

export async function llmCancel(requestId: string): Promise<boolean> {
  return invoke<boolean>("llm_cancel", { requestId });
}

// §3.2 Export commands
export async function exportDocument(
  htmlContent: string,
  outputPath: string,
  format: ExportFormat,
  options?: ExportOptions,
): Promise<void> {
  return invoke<void>("export_document", { htmlContent, outputPath, format, options });
}

// §5.10 PDF export via headless Chrome
export async function exportPdf(
  htmlContent: string,
  outputPath: string,
  options?: PdfOptions,
): Promise<void> {
  return invoke<void>("export_pdf", { htmlContent, outputPath, options });
}

// §55 Pandoc Extended Export commands
export async function detectPandoc(pandocPath?: string): Promise<PandocInfo> {
  return invoke<PandocInfo>("detect_pandoc", { pandocPath });
}

export async function exportPandoc(
  markdownContent: string,
  outputPath: string,
  format: string,
  pandocPath?: string,
  referenceDoc?: string,
  extraArgs?: string[],
): Promise<void> {
  return invoke<void>("export_pandoc", {
    markdownContent,
    outputPath,
    format,
    pandocPath,
    referenceDoc,
    extraArgs,
  });
}

export async function runCustomExport(
  command: string,
  filePath: string,
  outputPath: string,
  vaultDir?: string,
): Promise<void> {
  return invoke<void>("run_custom_export", {
    command,
    filePath,
    outputPath,
    vaultDir,
  });
}

// §57b Git commands
export async function gitStatus(path: string): Promise<GitStatusInfo> {
  return invoke<GitStatusInfo>("git_status", { path });
}

export async function gitStage(path: string, files: string[]): Promise<void> {
  return invoke<void>("git_stage", { path, files });
}

export async function gitUnstage(path: string, files: string[]): Promise<void> {
  return invoke<void>("git_unstage", { path, files });
}

export async function gitCommit(path: string, message: string): Promise<string> {
  return invoke<string>("git_commit", { path, message });
}

export async function gitDiffFile(path: string, filePath: string): Promise<GitFileDiff> {
  return invoke<GitFileDiff>("git_diff_file", { path, filePath });
}

export async function gitBranches(path: string): Promise<GitBranchInfo[]> {
  return invoke<GitBranchInfo[]>("git_branches", { path });
}

export async function gitSwitchBranch(path: string, branchName: string): Promise<void> {
  return invoke<void>("git_switch_branch", { path, branchName });
}

export async function gitDiscard(path: string, files: string[]): Promise<void> {
  return invoke<void>("git_discard", { path, files });
}

export async function gitCreateBranch(path: string, branchName: string): Promise<void> {
  return invoke<void>("git_create_branch", { path, branchName });
}

// macOS file association: get pending file paths from cold start
export async function getOpenedUrls(): Promise<string[]> {
  return invoke<string[]>("get_opened_urls");
}

// §6.3 Keyring commands — OS Keychain 암호화 저장
export async function keyringStore(key: string, value: string): Promise<void> {
  return invoke<void>("keyring_store", { key, value });
}

export async function keyringGet(key: string): Promise<string | null> {
  return invoke<string | null>("keyring_get", { key });
}

export async function keyringDelete(key: string): Promise<void> {
  return invoke<void>("keyring_delete", { key });
}

// §3.2 Config commands — app_data_dir/config.json 기반 영속화
export async function getConfig(key: string): Promise<string | null> {
  return invoke<string | null>("get_config", { key });
}

export async function setConfig(
  key: string,
  value: string,
): Promise<void> {
  return invoke<void>("set_config", { key, value });
}

export async function removeConfig(key: string): Promise<void> {
  return invoke<void>("remove_config", { key });
}
