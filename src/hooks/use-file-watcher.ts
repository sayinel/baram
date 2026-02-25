// File system watcher hook — listens for file:created/deleted events and updates FileTree
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { watchDir } from "../ipc/invoke";
import { useFileStore } from "../stores/file-store";
import type { FileEntry } from "../stores/file-store";

/** Directories and patterns to ignore (mirrors list_dir skip logic in Rust) */
const SKIP_DIRS = new Set([
  "node_modules", "target", "build", "dist",
  "__pycache__", ".next", ".git",
]);

function shouldSkip(path: string): boolean {
  const parts = path.split("/");
  return parts.some((p) => p.startsWith(".") || SKIP_DIRS.has(p));
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.substring(0, idx) : path;
}

function fileName(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.substring(idx + 1) : path;
}

/**
 * Hook that starts the Rust file watcher when a folder is open
 * and updates the FileTree store on file:created / file:deleted events.
 */
export function useFileWatcher() {
  const rootPath = useFileStore((s) => s.rootPath);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Map<string, "created" | "deleted">>(new Map());

  useEffect(() => {
    if (!rootPath) return;

    const unlistenFns: UnlistenFn[] = [];

    const flush = () => {
      const store = useFileStore.getState();
      const pending = new Map(pendingRef.current);
      pendingRef.current.clear();

      for (const [path, kind] of pending) {
        if (kind === "deleted") {
          store.removeFileEntry(path);
        } else if (kind === "created") {
          const name = fileName(path);
          const parent = parentDir(path);
          // Determine isDir heuristic: no extension = likely dir
          // But we can't know for sure from the event alone.
          // Files typically have extensions; dirs don't.
          const hasExt = name.includes(".");
          const entry: FileEntry = {
            name,
            path,
            isDir: !hasExt,
            children: !hasExt ? [] : undefined,
          };
          store.addFileEntry(parent, entry);
        }
      }
    };

    const scheduleFlush = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(flush, 300);
    };

    // Start watcher
    watchDir(rootPath).catch((err) =>
      console.warn("useFileWatcher: watchDir failed", err),
    );

    // Listen for events
    listen<{ path: string }>("file:created", (event) => {
      const p = event.payload.path;
      if (shouldSkip(p)) return;
      // If there's a pending "deleted" for the same path, cancel it (rename = delete + create)
      if (pendingRef.current.get(p) === "deleted") {
        pendingRef.current.delete(p);
      } else {
        pendingRef.current.set(p, "created");
      }
      scheduleFlush();
    }).then((fn) => unlistenFns.push(fn));

    listen<{ path: string }>("file:deleted", (event) => {
      const p = event.payload.path;
      if (shouldSkip(p)) return;
      // If there's a pending "created" for the same path, cancel it
      if (pendingRef.current.get(p) === "created") {
        pendingRef.current.delete(p);
      } else {
        pendingRef.current.set(p, "deleted");
      }
      scheduleFlush();
    }).then((fn) => unlistenFns.push(fn));

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      for (const fn of unlistenFns) fn();
    };
  }, [rootPath]);
}
