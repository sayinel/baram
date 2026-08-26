// File system watcher hook — listens for file:created/deleted/changed events and updates FileTree
import { useEffect, useRef } from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type { FileEntry } from "../stores/file/file";

import { useShallow } from "zustand/shallow";

import { watchDir } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { logger } from "../utils/logger";
import { showConflictModal, triggerAutoReload } from "./use-file-operations";

/** Directories and patterns to ignore (mirrors list_dir skip logic in Rust) */
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "__pycache__",
  "build",
  "dist",
  "node_modules",
  "target",
]);

interface ChangedPayload {
  mtime: number;
  /**
   * §313 이 변경을 만든 쪽. `"app"`은 이 앱의 `write_file`이 만든 것이고, Rust가 쓰기
   * 직후의 mtime과 대조해 판정한다 — 프론트엔드가 추측하지 않는다. 오래된 백엔드나
   * 판정 실패는 `undefined`로 도착하며, 그때는 외부 변경으로 다룬다(안전한 쪽).
   */
  origin?: "app" | "external";
  path: string;
}

interface CreatedPayload {
  isDir: boolean;
  path: string;
}

interface DeletedPayload {
  path: string;
}

interface PendingEntry {
  isDir?: boolean;
  kind: "created" | "deleted";
}

/**
 * Hook that starts the Rust file watcher when a folder is open
 * and updates the FileTree store on file:created / file:deleted events.
 */
export function useFileWatcher() {
  const rootPath = useFileStore((s) => s.rootPath);
  const debounceRef = useRef<null | ReturnType<typeof setTimeout>>(null);
  const pendingRef = useRef<Map<string, PendingEntry>>(new Map());
  const externalDirsRef = useRef<Set<string>>(new Set());
  // Paths of currently open file tabs — drives out-of-vault watching below.
  const openFilePaths = useEditorStore(
    useShallow((s) =>
      s.tabs.map((t) => t.filePath).filter((p) => p.length > 0),
    ),
  );

  // Register watcher event listeners once on mount, independent of rootPath, so
  // single files opened without a vault still receive change events.
  useEffect(() => {
    const unlistenFns: UnlistenFn[] = [];

    const flush = () => {
      const store = useFileStore.getState();
      const pending = new Map(pendingRef.current);
      pendingRef.current.clear();

      for (const [path, entry] of pending) {
        if (entry.kind === "deleted") {
          store.removeFileEntry(path);
        } else if (entry.kind === "created") {
          const name = fileName(path);
          const parent = parentDir(path);
          const isDir = entry.isDir ?? false;
          const fileEntry: FileEntry = {
            name,
            path,
            isDir,
            children: isDir ? [] : undefined,
          };
          store.addFileEntry(parent, fileEntry);
        }
      }
    };

    const scheduleFlush = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, 300);
    };

    // Listen for events — use async IIFE so unlistenFns is populated before
    // cleanup can run, closing the race window when rootPath changes quickly.
    let cleanedUp = false;
    (async () => {
      const [unlistenCreated, unlistenDeleted, unlistenChanged] =
        await Promise.all([
          listen<CreatedPayload>("file:created", (event) => {
            const p = event.payload.path;
            if (shouldSkip(p, event.payload.isDir)) return;
            // If there's a pending "deleted" for the same path, cancel it (rename = delete + create)
            const existing = pendingRef.current.get(p);
            if (existing?.kind === "deleted") {
              pendingRef.current.delete(p);
            } else {
              pendingRef.current.set(p, {
                kind: "created",
                isDir: event.payload.isDir,
              });
            }
            scheduleFlush();
          }),
          listen<DeletedPayload>("file:deleted", (event) => {
            const p = event.payload.path;
            if (shouldSkip(p)) return;
            // If there's a pending "created" for the same path, cancel it
            const existing = pendingRef.current.get(p);
            if (existing?.kind === "created") {
              pendingRef.current.delete(p);
            } else {
              pendingRef.current.set(p, { kind: "deleted" });
            }
            scheduleFlush();
          }),
          listen<ChangedPayload>("file:changed", (event) => {
            const filePath = event.payload.path;
            const externalMtime = event.payload.mtime;

            // Ignore changes to files that are not open
            const isOpen = useFileStore.getState().openFiles.has(filePath);
            if (!isOpen) return;

            // Ignore self-write echoes: an atomic save (tmp + rename) can surface
            // as a file:changed event. If the reported mtime is not newer than our
            // own last save, this was almost certainly triggered by our own write.
            const prevMtime = useFileStore.getState().getFileMtime(filePath);
            if (
              prevMtime &&
              externalMtime > 0 &&
              externalMtime <= prevMtime.lastSaveMtime
            ) {
              return;
            }

            // Record the external mtime
            useFileStore
              .getState()
              .updateCanReloadMtime(filePath, externalMtime);

            // Check dirty state
            const tabs = useEditorStore.getState().tabs;
            const tab = tabs.find((t) => t.filePath === filePath);
            const isDirty = tab?.isDirty ?? false;

            if (!isDirty) {
              // §313 앱 자신의 쓰기는 외부 변경이 아니다 — 토스트도, 실행 취소를
              // 버리는 재구축도 하지 않는다. dirty 탭은 아래 그대로다: 앱이 디스크에
              // 쓴 것과 사용자가 버퍼에 친 것이 갈라져 있으므로 동의 없이 어느 한쪽을
              // 버릴 수 없고, 그 판단은 충돌 모달이 사용자에게 묻는다.
              triggerAutoReload(filePath, externalMtime, {
                appOrigin: event.payload.origin === "app",
              }).catch((err) =>
                logger.warn("useFileWatcher: triggerAutoReload failed", err),
              );
            } else {
              // Capture the pre-external content (last synced) as the 3-way base.
              const base =
                useFileStore.getState().openFiles.get(filePath) ?? "";
              showConflictModal(filePath, externalMtime, base);
            }
          }),
        ]);

      if (cleanedUp) {
        // Cleanup already ran before listeners resolved — unlisten immediately
        try {
          unlistenCreated();
        } catch {
          /* listener already removed */
        }
        try {
          unlistenDeleted();
        } catch {
          /* listener already removed */
        }
        try {
          unlistenChanged();
        } catch {
          /* listener already removed */
        }
      } else {
        unlistenFns.push(unlistenCreated, unlistenDeleted, unlistenChanged);
      }
    })().catch(() => {
      /* Prevent unhandled rejection if listen() itself fails */
    });

    return () => {
      cleanedUp = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const fn of unlistenFns) {
        try {
          fn();
        } catch {
          /* listener already removed — safe to ignore */
        }
      }
    };
  }, []);

  // Watch the vault root directory whenever a vault is open.
  useEffect(() => {
    if (!rootPath) return;
    watchDir(rootPath).catch((err) =>
      logger.warn("useFileWatcher: watchDir failed", err),
    );
  }, [rootPath]);

  // §3.6 Out-of-vault files: when the vault is open (so the watcher listeners
  // above are active), also watch the parent directory of any open file that
  // lives outside the vault root, so external edits to it are detected too.
  // Rust WatcherState dedups by path; we also track dirs locally to avoid
  // re-issuing watch_dir on every tab change.
  useEffect(() => {
    for (const filePath of openFilePaths) {
      if (
        rootPath &&
        (filePath === rootPath || filePath.startsWith(rootPath + "/"))
      )
        continue;
      const dir = parentDir(filePath);
      if (!dir || dir === filePath || externalDirsRef.current.has(dir))
        continue;
      externalDirsRef.current.add(dir);
      watchDir(dir).catch((err) =>
        logger.warn("useFileWatcher: external watchDir failed", err),
      );
    }
  }, [openFilePaths, rootPath]);
}

function fileName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.substring(idx + 1) : path;
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.substring(0, idx) : path;
}

function shouldSkip(path: string, isDir = false): boolean {
  const parts = path.split("/");
  // Apply dotfile filter only to directory segments (not the final filename),
  // so files like ".notes.md" or dirs like ".archive/" are handled correctly:
  // - directory components starting with "." are hidden system dirs → skip
  // - the filename itself may start with "." and still be a valid user file
  // - exception: if the last segment IS a directory (isDir=true), also apply
  //   the dotfile filter to it (e.g., a newly created ".hidden/" dir should skip)
  const dirs = parts.slice(0, -1);
  const lastName = parts[parts.length - 1] ?? "";
  return (
    dirs.some((p) => p.startsWith(".") || SKIP_DIRS.has(p)) ||
    SKIP_DIRS.has(lastName) ||
    (isDir && lastName.startsWith("."))
  );
}
