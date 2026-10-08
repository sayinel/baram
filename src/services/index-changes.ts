// §29 #824 The one listener for `index:changed`: Rust emits it once a command or a
// watcher batch has brought the link indexes up to date, and this turns it into the
// `indexVersion` bump Graph and Backlinks read.
//
// Installed by `main.tsx` before the app renders, so no writer can run while it is not
// yet listening — Rust emits before the writing command resolves, and an event with no
// listener is gone. It is its own subscription: a failure to subscribe to the watcher's
// `file:*` events (`useLinkIndexWatcher`) does not take it down.
import { listen } from "@tauri-apps/api/event";

import type { IndexChanged } from "../ipc/types";

import { useEditorStore } from "../stores/editor/editor";
import { useLinkStore } from "../stores/editor/link";

let installed: null | Promise<void> = null;

/** Subscribe once per page; later calls wait on the same subscription. */
export function installIndexChanges(): Promise<void> {
  installed ??= listen<IndexChanged>("index:changed", (e) =>
    onIndexChanged(e.payload),
  ).then(() => undefined);
  return installed;
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
