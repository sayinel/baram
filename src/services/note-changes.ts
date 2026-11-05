// §34 "These notes' text on disk changed" — the input the unlinked-mention search reads (issue 791).
//
// The unlinked-mention search (`find_unlinked_mentions`) walks the vault and reads the OTHER notes'
// bodies from disk; it never reads the link index. So `indexVersion` — "the link index changed",
// which a body edit that keeps its links does not raise — is the wrong signal for it. This is its
// signal, and it has two publishers, one per job:
//
// - CORRECTNESS: `useVaultChangeSync`, once per watcher batch. Every write to disk reaches the
//   watcher whoever made it — the webview's `writeFile`, the backend's own writers (tasks, tag and
//   link renames, plugins), another program — so no note change in a watched folder is missed.
//   It is late by the batch's wait (`VAULT_SYNC_QUIET_MS`, at most `VAULT_SYNC_MAX_WAIT_MS`).
// - SPEED: the webview's text writes (`writeFile` · `createFile` in `ipc/fs.ts`), at once. They are
//   the only webview callers of the `write_file` · `create_file` commands (`grep -rn
//   '"write_file"\|"create_file"' src`, tests excluded), so a note the app writes from here is heard
//   without the batch's wait. Everything else that changes notes — the webview's rename, delete,
//   copy, import and zip commands, the backend's writers, a sandboxed plugin's writes, which the
//   backend brokers — is heard from the watcher only.
//
// A webview write is therefore heard twice — once at once and once from its watcher echo. That costs
// one extra search when ANOTHER note was written; a listener that ignores the note it shows ignores
// both for its own saves. A module-level set rather than a store: nothing renders from it, and two
// announcements that land before one render must both be heard (a store field would keep only the
// later — the reason the first version of issue 791 went wrong).
import { isMarkdownFile } from "../utils/file-type";
import { logger } from "../utils/logger";

type Listener = (paths: readonly string[]) => void;

const listeners = new Set<Listener>();

/**
 * Tell every listener that the text of `paths` may have changed on disk. Paths that cannot name a
 * note are dropped; an extensionless path is kept (`isMarkdownFile`), since a folder's change can
 * add or remove notes. Nothing is told when no path is left. A throwing listener is logged and the
 * rest still hear.
 */
export function announceNoteChanges(paths: readonly string[]): void {
  const notes = paths.filter((p) => isMarkdownFile(p));
  if (notes.length === 0) return;
  for (const listener of [...listeners]) {
    try {
      listener(notes);
    } catch (err) {
      logger.error("[note-changes] listener failed", err);
    }
  }
}

/** Hear `announceNoteChanges`. Returns the unsubscribe. */
export function onNoteChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
