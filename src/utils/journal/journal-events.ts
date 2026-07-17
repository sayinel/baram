// §56 Journal events — lightweight pub/sub so journal sidebars refresh in
// real time instead of only on remount (close/reopen the panel).
//
// Two signals live here:
//
//   1. journal-changed — a journal entry was created or its content was saved.
//      Subscribers (calendar dots, Memories One Line/Full) re-read from disk.
//      Mirrors the `subscribeContentLoaded` pattern in
//      utils/editor/programmatic-update.ts: a module-level listener set, no
//      store/React overhead, and safe to import from both hooks and services.
//
//   2. body-cursor request — a journal file was just created from a template,
//      so when it loads the editor should drop the caret onto a plain-text line
//      below the date title instead of at the end of the title heading. The
//      request is one-shot and keyed by file path (consumed on first load).

const changedListeners = new Set<() => void>();

/** Notify subscribers that a journal entry was created or its content changed. */
export function notifyJournalChanged(): void {
  for (const fn of changedListeners) fn();
}

/** Subscribe to journal-changed notifications. Returns an unsubscribe fn. */
export function subscribeJournalChanged(fn: () => void): () => void {
  changedListeners.add(fn);
  return () => {
    changedListeners.delete(fn);
  };
}

const pendingBodyCursor = new Set<string>();

/**
 * Consume a pending body-cursor request for a file. Returns true if a request
 * was pending (and clears it). One-shot so reopening an existing journal never
 * moves the user's caret.
 */
export function consumeJournalBodyCursor(filePath: string): boolean {
  return pendingBodyCursor.delete(filePath);
}

/**
 * Request that the given just-created journal file gets its caret placed on a
 * body line below the title when it next loads into the editor.
 */
export function requestJournalBodyCursor(filePath: string): void {
  pendingBodyCursor.add(filePath);
}
