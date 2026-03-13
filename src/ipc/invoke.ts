// IPC invoke 유틸리티 — Tauri 커맨드 타입 안전 래퍼
import { invoke } from "@tauri-apps/api/core";

import type {
  BacklinkEntry,
  DiffResult,
  ExportFormat,
  ExportOptions,
  FileEntry,
  GitAheadBehind,
  GitBranchInfo,
  GitFileDiff,
  GitLogEntry,
  GitRemoteInfo,
  GitStashEntry,
  GitStatusInfo,
  IndexStats,
  InstalledPluginInfo,
  LinkGraph,
  ModelInfo,
  NamespaceRenameResult,
  PandocInfo,
  PdfOptions,
  PluginManifest,
  RegistryIndex,
  RenameResult,
  SearchOptions,
  SearchResult,
  SnapshotEntry,
  UnlinkedMention,
} from "./types";

/** §56m Vault-wide tag rename/merge */
export interface RenameTagResult {
  filesModified: number;
  occurrencesReplaced: number;
}

/** §56m Vault-wide tag index */
export interface TagEntry {
  count: number;
  tag: string;
}

export async function copyFile(from: string, to: string): Promise<void> {
  return invoke<void>("copy_file", { from, to });
}

export async function createDir(path: string): Promise<void> {
  return invoke<void>("create_dir", { path });
}

// §71 Snapshot commands
export async function createSnapshot(
  vaultPath: string,
  snapshotType: string,
  label?: string,
): Promise<string> {
  return invoke<string>("create_snapshot", {
    vaultPath,
    snapshotType,
    label: label ?? null,
  });
}

export async function deleteDir(path: string): Promise<void> {
  return invoke<void>("delete_dir", { path });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke<void>("delete_file", { path });
}

export async function deleteSnapshot(
  vaultPath: string,
  snapshotId: string,
): Promise<void> {
  return invoke<void>("delete_snapshot", { vaultPath, snapshotId });
}

// §55 Pandoc Extended Export commands
export async function detectPandoc(pandocPath?: string): Promise<PandocInfo> {
  return invoke<PandocInfo>("detect_pandoc", { pandocPath });
}

// §3.2 Export commands
export async function exportDocument(
  htmlContent: string,
  outputPath: string,
  format: ExportFormat,
  options?: ExportOptions,
): Promise<void> {
  return invoke<void>("export_document", {
    htmlContent,
    outputPath,
    format,
    options,
  });
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

// §5.10 PDF export via headless Chrome
export async function exportPdf(
  htmlContent: string,
  outputPath: string,
  options?: PdfOptions,
): Promise<void> {
  return invoke<void>("export_pdf", { htmlContent, outputPath, options });
}

/** §53 Extract a ZIP file to output directory, returns list of extracted file paths */
export async function extractZip(
  zipPath: string,
  outputDir: string,
): Promise<string[]> {
  return invoke<string[]>("extract_zip", { zipPath, outputDir });
}

// §3.2 Index commands
export async function getBacklinks(filePath: string): Promise<BacklinkEntry[]> {
  return invoke<BacklinkEntry[]>("get_backlinks", { filePath });
}

// §3.2 Config commands — app_data_dir/config.json 기반 영속화
export async function getConfig(key: string): Promise<null | string> {
  return invoke<null | string>("get_config", { key });
}

export async function getFileHistory(
  vaultPath: string,
  filePath: string,
): Promise<SnapshotEntry[]> {
  return invoke<SnapshotEntry[]>("get_file_history", { vaultPath, filePath });
}

/** Tag-based file filtering — returns relative paths of files containing the tag */
export async function getFilesByTag(
  rootPath: string,
  tag: string,
): Promise<string[]> {
  return invoke<string[]>("get_files_by_tag", { rootPath, tag });
}

export async function getLinkIndex(): Promise<LinkGraph> {
  return invoke<LinkGraph>("get_link_index");
}

// macOS file association: get pending file paths from cold start
export async function getOpenedUrls(): Promise<string[]> {
  return invoke<string[]>("get_opened_urls");
}

export async function getSnapshotDiff(
  vaultPath: string,
  snapshotId: string,
  filePath: string,
): Promise<DiffResult> {
  return invoke<DiffResult>("get_snapshot_diff", {
    vaultPath,
    snapshotId,
    filePath,
  });
}

// §34 Unlinked Mentions
export async function getUnlinkedMentions(
  filePath: string,
  rootPath: string,
): Promise<UnlinkedMention[]> {
  return invoke<UnlinkedMention[]>("get_unlinked_mentions", {
    filePath,
    rootPath,
  });
}

export async function getVaultTags(rootPath: string): Promise<TagEntry[]> {
  return invoke<TagEntry[]>("get_vault_tags", { rootPath });
}

export async function gitAheadBehind(
  path: string,
  branch?: string,
  remote?: string,
): Promise<GitAheadBehind> {
  return invoke<GitAheadBehind>("git_ahead_behind", { path, branch, remote });
}

export async function gitBranches(path: string): Promise<GitBranchInfo[]> {
  return invoke<GitBranchInfo[]>("git_branches", { path });
}

export async function gitCommit(
  path: string,
  message: string,
): Promise<string> {
  return invoke<string>("git_commit", { path, message });
}

export async function gitCreateBranch(
  path: string,
  branchName: string,
): Promise<void> {
  return invoke<void>("git_create_branch", { path, branchName });
}

export async function gitDeleteBranch(
  path: string,
  branchName: string,
): Promise<void> {
  return invoke<void>("git_delete_branch", { path, branchName });
}

export async function gitDiffFile(
  path: string,
  filePath: string,
): Promise<GitFileDiff> {
  return invoke<GitFileDiff>("git_diff_file", { path, filePath });
}

export async function gitDiscard(path: string, files: string[]): Promise<void> {
  return invoke<void>("git_discard", { path, files });
}

export async function gitFetch(path: string, remote?: string): Promise<void> {
  return invoke<void>("git_fetch", { path, remote });
}

// §67 Git Advanced commands
export async function gitLog(
  path: string,
  maxCount?: number,
): Promise<GitLogEntry[]> {
  return invoke<GitLogEntry[]>("git_log", { path, maxCount });
}

export async function gitPull(
  path: string,
  remote?: string,
  branch?: string,
): Promise<string> {
  return invoke<string>("git_pull", { path, remote, branch });
}

export async function gitPush(
  path: string,
  remote?: string,
  branch?: string,
): Promise<void> {
  return invoke<void>("git_push", { path, remote, branch });
}

export async function gitRemotes(path: string): Promise<GitRemoteInfo[]> {
  return invoke<GitRemoteInfo[]>("git_remotes", { path });
}

export async function gitStage(path: string, files: string[]): Promise<void> {
  return invoke<void>("git_stage", { path, files });
}

export async function gitStashDrop(
  path: string,
  index?: number,
): Promise<void> {
  return invoke<void>("git_stash_drop", { path, index });
}

export async function gitStashList(path: string): Promise<GitStashEntry[]> {
  return invoke<GitStashEntry[]>("git_stash_list", { path });
}

export async function gitStashPop(path: string, index?: number): Promise<void> {
  return invoke<void>("git_stash_pop", { path, index });
}

export async function gitStashSave(
  path: string,
  message: string,
  includeUntracked?: boolean,
): Promise<string> {
  return invoke<string>("git_stash_save", { path, message, includeUntracked });
}

// §57b Git commands
export async function gitStatus(path: string): Promise<GitStatusInfo> {
  return invoke<GitStatusInfo>("git_status", { path });
}

export async function gitSwitchBranch(
  path: string,
  branchName: string,
): Promise<void> {
  return invoke<void>("git_switch_branch", { path, branchName });
}

export async function gitUnstage(path: string, files: string[]): Promise<void> {
  return invoke<void>("git_unstage", { path, files });
}

export async function keyringDelete(key: string): Promise<void> {
  return invoke<void>("keyring_delete", { key });
}

export async function keyringGet(key: string): Promise<null | string> {
  return invoke<null | string>("keyring_get", { key });
}

// §6.3 Keyring commands — OS Keychain 암호화 저장
export async function keyringStore(key: string, value: string): Promise<void> {
  return invoke<void>("keyring_store", { key, value });
}

export async function listDir(
  path: string,
  recursive?: boolean,
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_dir", { path, recursive });
}

export async function listSnapshots(
  vaultPath: string,
): Promise<SnapshotEntry[]> {
  return invoke<SnapshotEntry[]>("list_snapshots", { vaultPath });
}

export async function llmCancel(requestId: string): Promise<boolean> {
  return invoke<boolean>("llm_cancel", { requestId });
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

// §6.3 LLM commands
export async function llmListModels(
  provider: string,
  apiKey?: string,
  baseUrl?: string,
): Promise<ModelInfo[]> {
  return invoke<ModelInfo[]>("llm_list_models", { provider, apiKey, baseUrl });
}

export async function pluginFetchRegistry(url: string): Promise<RegistryIndex> {
  return invoke<RegistryIndex>("plugin_fetch_registry", { url });
}

export async function pluginGetDir(): Promise<string> {
  return invoke<string>("plugin_get_dir");
}

// §69 Plugin Marketplace commands
export async function pluginInstall(
  url: string,
  checksum?: string,
): Promise<InstalledPluginInfo> {
  return invoke<InstalledPluginInfo>("plugin_install", {
    url,
    checksum: checksum ?? null,
  });
}

export async function pluginListInstalled(): Promise<InstalledPluginInfo[]> {
  return invoke<InstalledPluginInfo[]>("plugin_list_installed");
}

export async function pluginReadManifest(
  pluginId: string,
): Promise<PluginManifest> {
  return invoke<PluginManifest>("plugin_read_manifest", { pluginId });
}

export async function pluginUninstall(pluginId: string): Promise<void> {
  return invoke<void>("plugin_uninstall", { pluginId });
}

// §3.2 File System commands
export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

export async function refreshIndex(rootPath: string): Promise<IndexStats> {
  return invoke<IndexStats>("refresh_index", { rootPath });
}

export async function removeConfig(key: string): Promise<void> {
  return invoke<void>("remove_config", { key });
}

// §30a Rename block ID with reference auto-update
export async function renameBlockId(
  filePath: string,
  oldId: string,
  newId: string,
): Promise<RenameResult> {
  return invoke<RenameResult>("rename_block_id", { filePath, oldId, newId });
}

export async function renameFile(from: string, to: string): Promise<void> {
  return invoke<void>("rename_file", { from, to });
}

// §33 Rename file with wikilink auto-update
export async function renameFileWithLinks(
  oldPath: string,
  newPath: string,
): Promise<RenameResult> {
  return invoke<RenameResult>("rename_file_with_links", { oldPath, newPath });
}

// §61 Rename namespace (directory) with relative wikilink auto-update
export async function renameNamespace(
  oldDir: string,
  newDir: string,
  rootPath: string,
): Promise<NamespaceRenameResult> {
  return invoke<NamespaceRenameResult>("rename_namespace", {
    oldDir,
    newDir,
    rootPath,
  });
}

export async function renameTag(
  rootPath: string,
  oldTag: string,
  newTag: string,
): Promise<RenameTagResult> {
  return invoke<RenameTagResult>("rename_tag", { rootPath, oldTag, newTag });
}

export async function restoreSnapshot(
  vaultPath: string,
  snapshotId: string,
  files?: string[],
): Promise<void> {
  return invoke<void>("restore_snapshot", {
    vaultPath,
    snapshotId,
    files: files ?? null,
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

// §5.11 Global Search
export async function searchFiles(
  rootPath: string,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  return invoke<SearchResult[]>("search_files", { rootPath, query, options });
}

export async function setConfig(key: string, value: string): Promise<void> {
  return invoke<void>("set_config", { key, value });
}

export async function updateFileIndex(filePath: string): Promise<void> {
  return invoke<void>("update_file_index", { filePath });
}

export async function watchDir(path: string): Promise<void> {
  return invoke<void>("watch_dir", { path });
}

/** §56d Write binary data to a file (for images, etc.) */
export async function writeBinaryFile(
  path: string,
  data: number[],
): Promise<void> {
  return invoke<void>("write_binary_file", { path, data });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_file", { path, content });
}
