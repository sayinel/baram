// §3.2 File System IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { FileEntry } from "./types";

/** §4.3 Sentinel emitted by the Rust `list_dir` command when read_dir is denied. */
const PERMISSION_DENIED_PREFIX = "PERMISSION_DENIED:";

/**
 * §277 Prefix from `FsError::NotFound`'s Display impl (`src-tauri/src/fs/mod.rs`),
 * which `read_file` rejects with (via `.map_err(|e| e.to_string())` in
 * `fs_cmd.rs`) when the path does not exist. Unlike `PERMISSION_DENIED:` above,
 * this was not designed as a dedicated ASCII sentinel — it is the pre-existing
 * Korean error copy — but it is already distinct from the generic
 * `FsError::ReadError` branch's "파일 읽기 실패:" prefix (permission-denied
 * reads, invalid-UTF-8 decode failures), so no Rust change is needed to detect
 * it. A future wording edit to that Display string would need updating here too.
 */
const READ_FILE_NOT_FOUND_PREFIX = "파일을 찾을 수 없습니다:";

/** §4.3 Thrown by `listDir` when the OS denied folder access (macOS TCC / EACCES). */
export class FolderAccessDeniedError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`Folder access denied: ${path}`);
    this.name = "FolderAccessDeniedError";
    this.path = path;
  }
}

export async function copyFile(from: string, to: string): Promise<void> {
  return invoke<void>("copy_file", { from, to });
}

export async function createDir(path: string): Promise<void> {
  return invoke<void>("create_dir", { path });
}

export async function deleteDir(path: string): Promise<void> {
  return invoke<void>("delete_dir", { path });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke<void>("delete_file", { path });
}

/**
 * §5.1 Export binary data to a user-chosen path (e.g. SVG → PNG download).
 * NOT vault-confined — the path comes from the native save dialog, so saving
 * outside the vault (Downloads/Desktop) works. Mirrors export_pdf policy.
 */
export async function exportBinaryFile(
  path: string,
  data: number[],
): Promise<void> {
  return invoke<void>("export_binary_file", { path, data });
}

/** §53 Extract a ZIP file to output directory, returns list of extracted file paths */
export async function extractZip(
  zipPath: string,
  outputDir: string,
): Promise<string[]> {
  return invoke<string[]>("extract_zip", { zipPath, outputDir });
}

// macOS file association: get pending file paths from cold start
export async function getOpenedUrls(): Promise<string[]> {
  return invoke<string[]>("get_opened_urls");
}

/** Import a file from any location (including outside vault) into the vault.
 *  Only the destination path is vault-confined; source may be external. */
export async function importFile(from: string, to: string): Promise<void> {
  return invoke<void>("import_file", { from, to });
}

/**
 * §277 True when `e` is a rejection from `readFile` (or another `read_file`-
 * backed call) caused by the file not existing, as opposed to a permission or
 * decode failure. Callers that must not conflate "safe to treat as a new
 * file" with "read failed for an unrelated reason" — e.g. appending to a
 * companion note that may already have content worth preserving — should
 * branch on this instead of swallowing every `readFile` rejection alike.
 */
export function isFileNotFoundError(e: unknown): boolean {
  return typeof e === "string" && e.startsWith(READ_FILE_NOT_FOUND_PREFIX);
}

export function isFolderAccessDeniedError(
  e: unknown,
): e is FolderAccessDeniedError {
  return e instanceof FolderAccessDeniedError;
}

export async function listDir(
  path: string,
  recursive?: boolean,
): Promise<FileEntry[]> {
  try {
    return await invoke<FileEntry[]>("list_dir", { path, recursive });
  } catch (e) {
    // Tauri rejects with the command's error String.
    if (typeof e === "string" && e.startsWith(PERMISSION_DENIED_PREFIX)) {
      throw new FolderAccessDeniedError(
        e.slice(PERMISSION_DENIED_PREFIX.length),
      );
    }
    throw e;
  }
}

// §3.2 File System commands
export async function readFile(path: string): Promise<string> {
  return invoke<string>("read_file", { path });
}

export async function renameFile(from: string, to: string): Promise<void> {
  return invoke<void>("rename_file", { from, to });
}

/** Register the open vault root with the Rust backend for path confinement. */
export async function setVaultRoot(path: string): Promise<void> {
  return invoke<void>("set_vault_root", { path });
}

export async function watchDir(path: string): Promise<void> {
  return invoke<void>("watch_dir", { path });
}

/** §56d Write binary data to a file (for images, etc.) — vault-confined. */
export async function writeBinaryFile(
  path: string,
  data: number[],
): Promise<void> {
  return invoke<void>("write_binary_file", { path, data });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke<void>("write_file", { path, content });
}
