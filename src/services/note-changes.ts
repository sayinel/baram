// §34 "Notes on disk changed" — the input the unlinked-mention search reads (issue 791).
//
// The unlinked-mention search (`find_unlinked_mentions`) walks the vault and reads the OTHER notes'
// bodies from disk; it never reads the link index. So `indexVersion` — "the link index changed",
// which a body edit that keeps its links does not raise — is the wrong signal for it. This is its
// signal, and it has two publishers:
//
// - `useVaultChangeSync`, once per watcher batch that the sync answered, from what Rust judged each
//   path to be on disk (`SyncAnswer::notes` · `tree_changed` in `index/service/sync.rs`). So a path
//   under a hidden or tool folder, or one no context holds, is not heard, and a folder renamed or
//   moved is heard though it names no note. It hears what the watcher reports — it filters some
//   folders itself and can fail to start (`fs::start_watching`, `useFileWatcher`) — and a batch whose
//   sync fails is dropped, as the batcher says. It is late by the batch's wait (`VAULT_SYNC_QUIET_MS`,
//   at most `VAULT_SYNC_MAX_WAIT_MS`) and by the sync itself, since batches run one at a time.
// - The webview's text writes (`writeFile` · `createFile` in `ipc/fs.ts`), at once. They are
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
// later).
import { isMarkdownFile } from "../utils/file-type";
import { logger } from "../utils/logger";

/** The notes that changed, or `null` when notes may have come or gone unnamed. */
type Listener = (paths: null | readonly string[]) => void;

const listeners = new Set<Listener>();

/**
 * Tell every listener that the text of `paths` may have changed on disk. Paths that `isMarkdownFile`
 * rejects are dropped (`writeFile` also writes JSON and the like). Nothing is told when no path is
 * left.
 */
export function announceNoteChanges(paths: readonly string[]): void {
  const notes = paths.filter((p) => isMarkdownFile(p));
  if (notes.length > 0) tell(notes);
}

/** Tell every listener that notes may have come or gone, which ones unknown (see the header). */
export function announceUnnamedNoteChanges(): void {
  tell(null);
}

/** Hear both announcements. Returns the unsubscribe. */
export function onNoteChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A throwing listener is logged and the rest still hear. */
function tell(paths: null | readonly string[]): void {
  for (const listener of [...listeners]) {
    try {
      listener(paths);
    } catch (err) {
      logger.error("[note-changes] listener failed", err);
    }
  }
}
