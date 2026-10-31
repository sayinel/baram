// §395 spec 0074 D10 · D11 · D12 · §5.4 — the app's own rename, move and delete, told once each. An app
// operation that renames, moves or deletes files through the five IPC wrappers (spec 0074 §2) raises the
// gate before its first disk IPC (`beginFileOperation`, as the first statement of the `try` around it),
// calls `notifyRenamed` / `notifyDeleted` once that IPC succeeded — where it updates the tree, in the same
// synchronous span — and releases in the `finally`. A notice moves or drops the decoration keys first and
// then tells its listeners, so the held `vault:changed` the release lets out comes after it. Changes made
// outside the app are never told here (D13).
import { holdVaultChanges } from "../../services/vault-changes";
import { contextsContaining } from "../../stores/context/contexts-containing";
import { logger } from "../../utils/logger";
import { dropDecorations, moveDecorations } from "./file-decoration-store";

/** What an app operation did, as listeners hear it — absolute paths, and whether the entry was a folder. */
export type FileNotice =
  | { from: string; isDir: boolean; kind: "rename"; to: string }
  | { isDir: boolean; kind: "delete"; path: string };

const listeners = new Set<(notice: FileNotice) => void>();

/**
 * D12 — hold `vault:changed` of every vault or folder context holding one of `paths`
 * (`contextsContaining`) until the returned release runs. Released by the caller's `finally`, after the
 * notice — never by time.
 */
export function beginFileOperation(paths: readonly string[]): () => void {
  return holdVaultChanges(
    paths.flatMap((path) =>
      contextsContaining(path).map((context) => context.id),
    ),
  );
}

/** D10 — the app deleted `path` (a folder with what it held): its decoration keys go, then listeners hear it. */
export function notifyDeleted(path: string, isDir: boolean): void {
  dropDecorations(path, isDir);
  tell({ isDir, kind: "delete", path });
}

/**
 * D10 — the app renamed or moved `from` to `to`: the decoration keys move first, then listeners hear it.
 * `isDir` is the branch the operation took (a folder rename, or a file's).
 */
export function notifyRenamed(from: string, to: string, isDir: boolean): void {
  moveDecorations(from, to, isDir);
  tell({ from, isDir, kind: "rename", to });
}

/** Hear every notice; returns the unsubscriber. */
export function onFileNotice(
  listener: (notice: FileNotice) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A throwing listener is logged and the rest still hear. */
function tell(notice: FileNotice): void {
  for (const listener of [...listeners]) {
    try {
      listener(notice);
    } catch (err) {
      logger.error("[file-notices] listener failed", err);
    }
  }
}
