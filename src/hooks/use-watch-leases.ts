// §3.2 The directory watches the main window holds, and when it gives them back (#797).
import { useEffect, useRef } from "react";

import { setOpenFiles, unwatchDir, watchDir } from "../ipc/invoke";
import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import { useUIStore } from "../stores/ui/ui";
import { logger } from "../utils/logger";

/** A lease being taken: resolves to its id, or `undefined` if the watch failed. */
type Pending = Promise<number | undefined>;

/**
 * The main window's watches.
 *
 * - **Vault roots.** One recursive lease per directory context this window has made
 *   active this session, kept after a switch and given back when that context is
 *   removed. Kept on purpose: the link index of a vault visited earlier stays current
 *   only through its watch (use-link-index-watcher → `sync_watched_paths`, #790), and
 *   a rename there would miss referrers otherwise. A Rust-owned lease per registered
 *   context, independent of the window, is #824's.
 * - **Out-of-vault tabs.** One non-recursive lease per open file outside the active
 *   root, on its folder, with that file as `focus` — released when the tab closes.
 *
 * Every lease is given back on unmount; Rust also gives back a window's leases when the
 * window is destroyed.
 */
export function useWatchLeases(
  rootPath: null | string,
  openFilePaths: string[],
): void {
  const roots = useRef(new Map<string, Pending>());
  const files = useRef(new Map<string, Pending>());
  const contexts = useContextStore((s) => s.contexts);
  const seenInContexts = useRef(new Set<string>());

  // A vault root: the open set first, so tabs restored inside an excluded folder are
  // registered before the watch that would drop their events starts (#795).
  useEffect(() => {
    if (!rootPath || roots.current.has(rootPath)) return;
    roots.current.set(
      rootPath,
      registerOpenFiles(currentOpenFilePaths()).then(() => take(rootPath, {})),
    );
  }, [rootPath]);

  // A removed context gives its root back — only one the store has listed, so a root
  // set before its context is registered is not released early.
  useEffect(() => {
    const listed = new Set(
      contexts.filter((c) => c.contextType !== "file").map((c) => c.path),
    );
    for (const path of listed) seenInContexts.current.add(path);
    for (const [path, pending] of roots.current) {
      if (seenInContexts.current.has(path) && !listed.has(path)) {
        roots.current.delete(path);
        seenInContexts.current.delete(path);
        give(pending);
      }
    }
  }, [contexts]);

  // §3.2 Sent on every change of the open set. A tab opened while a watch runs is
  // registered one IPC round trip after it appears in the store: a change to it
  // inside an excluded folder in that window is not reported.
  useEffect(() => {
    void registerOpenFiles(openFilePaths);
  }, [openFilePaths]);

  // §3.6 An open file outside the active root: its folder, non-recursively.
  useEffect(() => {
    const wanted = new Set(
      openFilePaths.filter(
        (p) => !rootPath || (p !== rootPath && !p.startsWith(rootPath + "/")),
      ),
    );
    for (const [file, pending] of files.current) {
      if (wanted.has(file)) continue;
      files.current.delete(file);
      give(pending);
    }
    for (const file of wanted) {
      const dir = parentDir(file);
      if (files.current.has(file) || !dir || dir === file) continue;
      files.current.set(file, take(dir, { focus: file, recursive: false }));
    }
  }, [openFilePaths, rootPath]);

  // Everything back on unmount. Under StrictMode's mount → unmount → mount this gives
  // back what the first mount took, and the second takes it again.
  useEffect(() => {
    const rootLeases = roots.current;
    const fileLeases = files.current;
    const seen = seenInContexts.current;
    return () => {
      for (const pending of [...rootLeases.values(), ...fileLeases.values()]) {
        give(pending);
      }
      rootLeases.clear();
      fileLeases.clear();
      seen.clear();
    };
  }, []);
}

/** The open set, read now — the same selection `openFilePaths` makes. */
function currentOpenFilePaths(): string[] {
  return useEditorStore
    .getState()
    .tabs.map((t) => t.filePath)
    .filter((p) => p.length > 0);
}

/** Give a lease back once it is known; a watch that never started has none. */
function give(pending: Pending): void {
  void pending.then((lease) => {
    if (lease === undefined) return;
    unwatchDir(lease).catch((err) =>
      logger.warn("useWatchLeases: unwatchDir failed", err),
    );
  });
}

function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.substring(0, idx) : path;
}

/**
 * §3.2 `setOpenFiles`. The watch starts either way. A refused call leaves the watcher
 * with no known open set, which makes it filter nothing (watch_filter.rs, issue 795):
 * safe for an open file, at the cost of build-output events reaching the webview until
 * the next change of the open set retries. That is said once per failure streak.
 */
let registrationFailing = false;
async function registerOpenFiles(paths: string[]): Promise<void> {
  try {
    await setOpenFiles(paths);
    registrationFailing = false;
  } catch (err) {
    logger.error("useFileWatcher: setOpenFiles failed", err);
    if (!registrationFailing) {
      registrationFailing = true;
      useUIStore
        .getState()
        .showToast(
          "Couldn't tell the file watcher which files are open — it will report every change until this succeeds",
          "warning",
        );
    }
  }
}

function take(
  path: string,
  options: { focus?: string; recursive?: boolean },
): Pending {
  return watchDir(path, options).then(
    (lease) => (typeof lease === "number" ? lease : undefined),
    (err: unknown) => {
      logger.warn("useWatchLeases: watchDir failed", path, err);
      return undefined;
    },
  );
}
