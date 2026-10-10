// §29 #824 The one listener for `index:changed`: Rust emits it once a command or a
// watcher batch has brought the link indexes up to date, and this turns it into the
// `indexVersion` bump Graph and Backlinks read.
//
// Installed by `main.tsx` before the app renders, so no writer can run while it is not
// yet listening — Rust emits before the writing command resolves, and an event with no
// listener is gone. It is the only subscription the link index needs: Rust's watcher
// applier announces other programs' writes the same way, so no `file:*` listener feeds
// the index.
//
// A subscription that fails is not the answer for the window's lifetime: it is retried
// in the background with a doubling wait, and the one that finally succeeds bumps once,
// since whatever was announced in between reached no one.
import { listen } from "@tauri-apps/api/event";

import type { IndexChanged } from "../ipc/types";

import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";

/** The wait before a failed subscription is first tried again; it doubles per failure. */
export const RETRY_FIRST_MS = 250;
/** The longest wait between two tries. */
const RETRY_MAX_MS = 30_000;

let installed: null | Promise<void> = null;
let retry: null | ReturnType<typeof setTimeout> = null;
/** A subscription failed since the last one that held: events may have been missed. */
let missed = false;

/**
 * Subscribe once per page; later calls wait on the same subscription. A rejection is
 * returned to the caller and a retry is scheduled; a later call after it tries again.
 */
export function installIndexChanges(): Promise<void> {
  installed ??= subscribe(RETRY_FIRST_MS);
  return installed;
}

function subscribe(wait: number): Promise<void> {
  return listen<IndexChanged>("index:changed", (e) =>
    onIndexChanged(e.payload),
  ).then(
    () => {
      if (missed) {
        missed = false;
        useLinkStore.getState().invalidate();
      }
    },
    (e: unknown) => {
      installed = null;
      missed = true;
      retry ??= setTimeout(() => {
        retry = null;
        if (installed !== null) return;
        installed = subscribe(Math.min(wait * 2, RETRY_MAX_MS));
        installed.catch((err: unknown) =>
          console.warn("[index-changes] subscription retry failed", err),
        );
      }, wait);
      throw e;
    },
  );
}

/**
 * One file is named, in the spelling the active tab uses when it is among the event's
 * spellings or is its canonical path (#797: one file can arrive under several), so
 * Backlinks can tell its own save (#791); anything else re-reads everything.
 */
export function onIndexChanged({ entries, rebuilt }: IndexChanged): void {
  if (rebuilt.length === 0 && entries.length === 1) {
    useLinkStore.getState().invalidate(spellingShown(entries[0]));
  } else {
    useLinkStore.getState().invalidate();
  }
}

function spellingShown(entry: IndexChanged["entries"][number]): string {
  const { activeTabId, tabs } = useEditorStore.getState();
  const active = tabs.find((t) => t.id === activeTabId)?.filePath;
  if (
    active &&
    (entry.spellings.includes(active) || entry.canonical === active)
  ) {
    return active;
  }
  return entry.spellings[0] ?? entry.canonical;
}
