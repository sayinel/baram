// §3.2 File System IPC commands
import { invoke } from "@tauri-apps/api/core";

import type { FileEntry } from "./types";

/** §4.3 Sentinel emitted by the Rust `create_file` command when the path is taken. */
const ALREADY_EXISTS_PREFIX = "ALREADY_EXISTS:";

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

/**
 * §4.3 Result of a recursive folder import. `skippedSymlinks` is reported so
 * the caller can say a link was passed over rather than claim a clean copy.
 */
export interface CopyDirReport {
  copied: number;
  skippedSymlinks: number;
}

/**
 * §4.3 Thrown by `createFile` when something is already at the path. The OS decides,
 * so on a volume that ignores case — the macOS and Windows default — a name differing
 * only in case counts as taken. `path` is the path that was asked for, not the existing
 * file's own spelling.
 */
export class FileExistsError extends Error {
  readonly path: string;
  constructor(path: string) {
    super(`File already exists: ${path}`);
    this.name = "FileExistsError";
    this.path = path;
  }
}

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

/**
 * §4.3 Create a NEW file holding `content`, or throw {@link FileExistsError} if anything
 * is already at `path`. Unlike {@link writeFile}, which replaces the target, this never
 * touches an existing file — use it wherever the caller means "make a new one" and has
 * only its own state (the file tree, the link index) as evidence the path is free.
 */
export async function createFile(path: string, content: string): Promise<void> {
  try {
    await invoke<void>("create_file", { content, path });
  } catch (e) {
    // Tauri rejects with the command's error String.
    if (typeof e === "string" && e.startsWith(ALREADY_EXISTS_PREFIX)) {
      throw new FileExistsError(e.slice(ALREADY_EXISTS_PREFIX.length));
    }
    throw e;
  }
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

/**
 * §4.3 Recursively import a folder from any location into the vault.
 * Same policy as `importFile` — only the destination is vault-confined.
 * Symlinks and `.DS_Store` are skipped, and `to` must not already exist.
 *
 * Resolves to `null` when `from` is not a directory. Rust has to decide that:
 * `from` is vault-external by design and `listDir` — the obvious probe — is
 * vault-confined, so it rejects every source path a drop can produce.
 */
export async function importDir(
  from: string,
  to: string,
): Promise<CopyDirReport | null> {
  return invoke<CopyDirReport | null>("import_dir", { from, to });
}

/** Import a file from any location (including outside vault) into the vault.
 *  Only the destination path is vault-confined; source may be external. */
export async function importFile(from: string, to: string): Promise<void> {
  return invoke<void>("import_file", { from, to });
}

export function isFileExistsError(e: unknown): e is FileExistsError {
  return e instanceof FileExistsError;
}

/**
 * §324-e Read a media file from ANY location (including outside the vault) as a
 * complete `data:<mime>;base64,…` URL.
 *
 * The Quick Capture dialog is the only caller: a capture is not a file yet, so
 * nothing it holds may reach the disk before Save, and a `data:` URL is the one
 * form that renders on a surface with no base directory. Everything that keeps
 * this narrow — the media-extension allowlist that doubles as the MIME table, the
 * byte cap, and why it grants the Host tier nothing it could not already do — is
 * documented in `src-tauri/src/fs/media.rs`. Read that before adding a caller.
 *
 * Rejects with `TOO_LARGE:{size}:{cap}` when the file is over the cap; callers
 * should use `isMediaTooLargeError` rather than matching that shape by hand.
 */
export async function readMediaDataUrl(path: string): Promise<string> {
  return invoke<string>("read_media_data_url", { path });
}

/**
 * §324-e True when `e` is `readMediaDataUrl` refusing a file for being over the
 * inline cap, as opposed to a missing file or an unreadable one. Returns the two
 * byte counts so the caller can say how big is too big — a refusal that does not
 * is the silent failure this whole path exists to remove.
 */
export function mediaTooLargeError(
  e: unknown,
): null | { cap: number; size: number } {
  if (typeof e !== "string" || !e.startsWith("TOO_LARGE:")) return null;
  const [, size, cap] = e.split(":");
  return { cap: Number(cap), size: Number(size) };
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

/**
 * §3.5 The settled tail of the writes still running per path (#798).
 *
 * Two writes to one path used to run concurrently, so the one that STARTED first could
 * land last: an auto-save still in flight while its tab closed, the file reopened under a
 * new tab and saved again, put the older text back on disk. Each write now waits for the
 * previous write to that path to settle — success or failure, so one failed write does
 * not block the next — and a read of the path waits too, so a reopen sees the write that
 * was already under way. An entry is removed once its tail settles with no later write
 * queued behind it.
 *
 * ‼️ The cost: a write that never settles holds back every later read and write of that
 * path. Writes Rust does on its own (link rewrites, task edits) are not in this queue.
 *
 * ‼️ Webview-only, and keyed by the path as spelled: `renameFile`, Rust-side writers and a
 * second spelling of the same file all pass it by. Serializing by the file's canonical
 * identity belongs in Rust — #824.
 */
const pendingWrites = new Map<string, Promise<void>>();

/** How many paths still have a write queued or running — for tests. */
export function pendingWritePaths(): number {
  return pendingWrites.size;
}

export async function readFile(path: string): Promise<string> {
  await pendingWrites.get(path);
  return invoke<string>("read_file", { path });
}

export async function renameFile(from: string, to: string): Promise<void> {
  return invoke<void>("rename_file", { from, to });
}

/** Register the open vault root with the Rust backend for path confinement. */
export async function setVaultRoot(path: string): Promise<void> {
  return invoke<void>("set_vault_root", { path });
}

/**
 * §3.2 Tell the watcher which files are open. It drops events below excluded folders
 * (`build/`, `target/`, …) except for these (issue 795).
 */
export async function setOpenFiles(paths: string[]): Promise<void> {
  return invoke<void>("set_open_files", { paths });
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

/**
 * Write `path` atomically, after any write to it already queued (#798). Resolves to the
 * written file's mtime — what the watcher reports for this write (issue 795); a tab's
 * own save records it through `asTabSave` (src/utils/editor/tab-save-in-flight.ts).
 */
export function writeFile(path: string, content: string): Promise<number> {
  const previous = pendingWrites.get(path) ?? Promise.resolve();
  const write = previous.then(() =>
    invoke<number>("write_file", { path, content }),
  );
  const settled = write.then(
    () => undefined,
    () => undefined,
  );
  pendingWrites.set(path, settled);
  void settled.then(() => {
    if (pendingWrites.get(path) === settled) pendingWrites.delete(path);
  });
  return write;
}
