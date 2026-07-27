// §298 Phase 1 (§12-9) — cancellation infrastructure for async editor
// mutations (design §5c, plan review 5차 CRITICAL 1 / 6차 핀 1·2).
//
// Problem: AI token streams, image-import promise chains, dialog and timer
// continuations all capture an editor across an async boundary and dispatch
// into it later — with no owner able to cancel them. When vim leaves insert
// mode, when a whole EditorState is installed (tab switch), or when the
// editor is torn down, those late continuations must become no-ops.
//
// Contract (6차 핀 2):
//   - register(...)  captures the CURRENT generation. Registering never
//     advances it — advancing on register would kill unrelated concurrent
//     tasks (핀: "generation은 무효화 시에만 전진").
//   - isLive()       synchronous truth for "may I still touch this editor?".
//     EVERY continuation (await / .then / Tauri event / timer / dialog)
//     must check it immediately before dispatching.
//   - addCleanup(fn) registers the best-effort source cancellation (abort a
//     stream, cancel a reader). If the task is already dead, fn runs now.
//   - finish()       normal completion — discards cleanups.
//
//   invalidateEditorMutationTasks(view)  SYNC: bumps the generation so every
//     outstanding isLive() flips false before any more JS runs.
//   abortEditorMutationTasks(view)       runs the invalidated tasks' cleanups
//     (best-effort, errors swallowed). Call AFTER the sync invalidate, per
//     the §5c sequence: invalidate → clear transients → transition → abort.
//
// Keyed by the PM EditorView instance (WeakMap — lifetime handles itself).
// The R6 rebinding hole (a task started for tab A staying "live" after the
// shared editor installs tab B's state) is closed by the trigger list, not
// by key granularity: replaceEditorStateWithVim invalidates before every
// install. Remaining triggers (insert→normal, owner deactivation, vim
// disable) are wired by the vim plugin in S1+.
//
// Leaf module: no vim imports, no store imports.
import type { EditorView as PMView } from "@tiptap/pm/view";

import { logger } from "../logger";

export interface EditorMutationTask {
  addCleanup(fn: () => void): void;
  finish(): void;
  isLive(): boolean;
}

interface TaskRecord {
  cleanups: (() => void)[];
  finished: boolean;
  generation: number;
}

interface ViewRegistry {
  dead: TaskRecord[];
  generation: number;
  live: Set<TaskRecord>;
}

const registries = new WeakMap<PMView, ViewRegistry>();

/** Best-effort source cancellation of previously invalidated tasks. */
export function abortEditorMutationTasks(view: PMView): void {
  const reg = registries.get(view);
  if (!reg) return;
  const dead = reg.dead.splice(0);
  for (const record of dead) {
    for (const fn of record.cleanups.splice(0)) runCleanup(fn);
  }
}

/**
 * Await a dialog/picker while holding a task bound to the document that
 * opened it, and report whether that document is still installed.
 *
 * Pass the promise directly — `awaitBoundToEditor(view, showPrompt(...))`.
 * Dialog helpers build their promise synchronously, so registration still
 * happens before any suspension point. Resolves to `null` when the document
 * was replaced while waiting; the caller must then do nothing.
 */
export async function awaitBoundToEditor<T>(
  view: PMView,
  pending: Promise<T>,
): Promise<null | T> {
  const task = registerEditorMutationTask(view);
  try {
    const value = await pending;
    return task.isLive() ? value : null;
  } finally {
    task.finish();
  }
}

/**
 * SYNC kill switch: after this returns, every outstanding task's isLive()
 * is false. Does NOT run cleanups — call abortEditorMutationTasks next.
 */
export function invalidateEditorMutationTasks(view: PMView): void {
  const reg = registries.get(view);
  if (!reg) return;
  reg.generation += 1;
  for (const record of reg.live) reg.dead.push(record);
  reg.live.clear();
}

/** Start tracking one async mutation flow (one request, not one listener). */
export function registerEditorMutationTask(view: PMView): EditorMutationTask {
  const reg = getRegistry(view);
  const record: TaskRecord = {
    cleanups: [],
    finished: false,
    generation: reg.generation,
  };
  reg.live.add(record);

  const isLive = () => !record.finished && record.generation === reg.generation;

  return {
    addCleanup(fn: () => void) {
      if (isLive()) {
        record.cleanups.push(fn);
      } else {
        // Task died between the async boundary and this call — cancel the
        // source immediately so nothing keeps streaming into the void.
        runCleanup(fn);
      }
    },
    finish() {
      record.finished = true;
      record.cleanups.length = 0;
      reg.live.delete(record);
    },
    isLive,
  };
}

function getRegistry(view: PMView): ViewRegistry {
  let reg = registries.get(view);
  if (!reg) {
    reg = { dead: [], generation: 0, live: new Set() };
    registries.set(view, reg);
  }
  return reg;
}

function runCleanup(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    logger.error("[mutation-tasks] cleanup callback threw:", err);
  }
}
