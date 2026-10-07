// §3.2 Every directory watch this page wants, held or waiting (#797).
//
// A watch is WANTED from `want` until its handle is released. While wanted it is
// pending (asked for), held (a lease), or queued (refused, or its lease ended). A queued
// watch is never dropped: it asks again after a backoff that grows to 30 s, and at once
// when Rust says it may succeed now (`watch:retry` — a watcher stopped, a context was
// registered). The backoff is what brings back a watch whose folder was deleted and
// made again: nothing in Rust announces that. While any wanted watch is queued,
// `useWatchStatusStore` says so and `WatchWarning` shows it.
//
// Rust ends a lease it can no longer serve (`watch:lease-ended`): the watch is queued
// and asked for again at once — through `watch_dir`'s authorization, from the folder
// as it resolves now.
import { listen } from "@tauri-apps/api/event";

import type { WatchRefusal } from "../ipc/fs";

import { create } from "zustand";

import { unwatchDir, watchDir, watchRefusal } from "../ipc/fs";
import { logger } from "../utils/logger";

export interface WatchHandle {
  release(): void;
}

type Reason = Exclude<WatchRefusal, "stale">;

interface Wanted {
  attempts: number;
  before?: () => Promise<void>;
  options: WatchOptions;
  path: string;
  released: boolean;
  state:
    | { kind: "held"; lease: number }
    | { kind: "pending" }
    | { kind: "queued"; reason: Reason };
  timer?: ReturnType<typeof setTimeout>;
}

interface WatchOptions {
  focus?: string;
  recursive?: boolean;
}

interface WatchStatus {
  /** Wanted watches that are not held, by why. */
  queued: Record<Reason, number>;
}

export const useWatchStatusStore = create<WatchStatus>()(() => ({
  queued: { capacity: 0, other: 0, unauthorized: 0 },
}));

/** The longest wait before a queued watch asks again. */
const MAX_BACKOFF_MS = 30_000;

const wanted = new Set<Wanted>();
let listening: null | Promise<void> = null;

/**
 * Want a watch on `path` until the handle is released. `before` runs once, before the
 * first request (the main window registers its open files there, #795).
 */
export function want(
  path: string,
  options: WatchOptions = {},
  before?: () => Promise<void>,
): WatchHandle {
  const entry: Wanted = {
    attempts: 0,
    before,
    options,
    path,
    released: false,
    state: { kind: "pending" },
  };
  wanted.add(entry);
  void listenOnce().then(() => attempt(entry));
  return {
    release() {
      if (entry.released) return;
      entry.released = true;
      wanted.delete(entry);
      clearTimeout(entry.timer);
      if (entry.state.kind === "held") give(entry.state.lease);
      publish();
    },
  };
}

async function attempt(entry: Wanted): Promise<void> {
  if (entry.released) return;
  clearTimeout(entry.timer);
  entry.state = { kind: "pending" };
  try {
    if (entry.before) {
      const before = entry.before;
      entry.before = undefined;
      await before();
    }
    const lease = await watchDir(entry.path, entry.options);
    if (entry.released) {
      give(lease);
      return;
    }
    entry.attempts = 0;
    entry.state = { kind: "held", lease };
  } catch (err) {
    if (entry.released) return;
    const refusal = watchRefusal(err);
    const reason: Reason = refusal === "stale" ? "other" : refusal;
    logger.warn("watch-leases: watchDir refused", entry.path, err);
    entry.state = { kind: "queued", reason };
    entry.attempts += 1;
    const wait = Math.min(1000 * 2 ** (entry.attempts - 1), MAX_BACKOFF_MS);
    entry.timer = setTimeout(() => void attempt(entry), wait);
  }
  publish();
}

function give(lease: number): void {
  unwatchDir(lease).catch((err: unknown) =>
    logger.warn("watch-leases: unwatchDir failed", err),
  );
}

/** The counts `WatchWarning` shows — set only when they change. */
function publish(): void {
  const queued: Record<Reason, number> = {
    capacity: 0,
    other: 0,
    unauthorized: 0,
  };
  for (const entry of wanted) {
    if (entry.state.kind === "queued") queued[entry.state.reason] += 1;
  }
  const current = useWatchStatusStore.getState().queued;
  if (
    current.capacity !== queued.capacity ||
    current.other !== queued.other ||
    current.unauthorized !== queued.unauthorized
  ) {
    useWatchStatusStore.setState({ queued });
  }
}

/** Rust's two events, listened to once per page before the first request. */
function listenOnce(): Promise<void> {
  listening ??= Promise.all([
    listen("watch:retry", () => {
      for (const entry of wanted) {
        if (entry.state.kind === "queued") void attempt(entry);
      }
    }),
    listen<{ lease: number }>("watch:lease-ended", (event) => {
      for (const entry of wanted) {
        if (
          entry.state.kind === "held" &&
          entry.state.lease === event.payload.lease
        ) {
          void attempt(entry);
        }
      }
    }),
  ]).then(
    () => undefined,
    (err: unknown) => {
      // The backoff still brings queued watches back, only slower.
      logger.error("watch-leases: listen failed", err);
    },
  );
  return listening;
}
