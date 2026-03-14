// File system watcher hook — listens for file:created/deleted events and updates FileTree
import { useEffect, useRef } from "react";

import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

import type { FileEntry } from "../stores/file-store";

import { watchDir } from "../ipc/invoke";
import { useFileStore } from "../stores/file-store";
import { logger } from "../utils/logger";

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

  useEffect(() => {
    if (!rootPath) return;

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

    // Start watcher
    watchDir(rootPath).catch((err) =>
      logger.warn("useFileWatcher: watchDir failed", err),
    );

    // Listen for events — use async IIFE so unlistenFns is populated before
    // cleanup can run, closing the race window when rootPath changes quickly.
    let cleanedUp = false;
    (async () => {
      const [unlistenCreated, unlistenDeleted] = await Promise.all([
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
      ]);

      if (cleanedUp) {
        // Cleanup already ran before listeners resolved — unlisten immediately
        unlistenCreated();
        unlistenDeleted();
      } else {
        unlistenFns.push(unlistenCreated, unlistenDeleted);
      }
    })();

    return () => {
      cleanedUp = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const fn of unlistenFns) fn();
    };
  }, [rootPath]);
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
