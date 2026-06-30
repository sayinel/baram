// §3.2 File System IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { FileEntry } from "./types";

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

export async function listDir(
  path: string,
  recursive?: boolean,
): Promise<FileEntry[]> {
  return invoke<FileEntry[]>("list_dir", { path, recursive });
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
