// §3.2 Link Index IPC commands
import { invoke } from "@tauri-apps/api/core";

import type {
  BacklinkEntry,
  IndexStats,
  LinkGraph,
  NamespaceRenameResult,
  RenameResult,
  UnlinkedMention,
} from "./types";

export async function getBacklinks(filePath: string): Promise<BacklinkEntry[]> {
  return invoke<BacklinkEntry[]>("get_backlinks", { filePath });
}

export async function getLinkIndex(): Promise<LinkGraph> {
  return invoke<LinkGraph>("get_link_index");
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

export async function refreshIndex(rootPath: string): Promise<IndexStats> {
  return invoke<IndexStats>("refresh_index", { rootPath });
}

// §30a Rename block ID with reference auto-update
export async function renameBlockId(
  filePath: string,
  oldId: string,
  newId: string,
): Promise<RenameResult> {
  return invoke<RenameResult>("rename_block_id", { filePath, oldId, newId });
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

export async function updateFileIndex(filePath: string): Promise<void> {
  return invoke<void>("update_file_index", { filePath });
}
