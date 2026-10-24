// §56m Tag IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { RenameTagResult, TagEntry } from "./types";

import { tagEntriesByName } from "../utils/tags/tag-name";

/** Tag-based file filtering — returns relative paths of files containing the tag */
export async function getFilesByTag(
  rootPath: string,
  tag: string,
): Promise<string[]> {
  return invoke<string[]>("get_files_by_tag", { rootPath, tag });
}

/** The vault's tags by name — rows that differ only by leading `#`s are one (`tagEntriesByName`). */
export async function getVaultTags(rootPath: string): Promise<TagEntry[]> {
  return tagEntriesByName(
    await invoke<TagEntry[]>("get_vault_tags", { rootPath }),
  );
}

/** §56m Vault-wide tag rename/merge */
export async function renameTag(
  rootPath: string,
  oldTag: string,
  newTag: string,
): Promise<RenameTagResult> {
  return invoke<RenameTagResult>("rename_tag", { rootPath, oldTag, newTag });
}
