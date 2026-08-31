// §18.18 M4 — the task-state ring, and reading a state back safely.
//
// The four states and the marker each is written as live in `ipc/types.ts`,
// because that table is the contract shared with Rust. What belongs here is the
// UI policy on top of it: which state a click moves to, and how an attribute
// that came from a document is coerced back into the enum.

import type { TaskState } from "../../ipc/types";

import { TASK_STATE_MARKER } from "../../ipc/types";

/**
 * Coerce a stored attribute into a state.
 *
 * Documents outlive code. A `data-state` can arrive from pasted HTML, from an
 * export written by an older build, or from a plugin, and ProseMirror will
 * carry whatever string it is given. Everything downstream indexes tables by
 * this value, so an unknown one has to become a real state here rather than
 * reaching a `Record` lookup as `undefined`.
 *
 * `TASK_STATE_MARKER` is the membership test on purpose — it is the one table
 * that has to list every state anyway, so a fifth state cannot be added without
 * this function learning about it.
 */
export function asTaskState(value: unknown): TaskState {
  return typeof value === "string" && value in TASK_STATE_MARKER
    ? (value as TaskState)
    : "todo";
}

/**
 * The click ring: todo → doing → done → todo.
 *
 * ‼️ `cancelled` is deliberately NOT on the ring. Cancelling is a decision
 * about a task, not a step on the way to finishing one, so a cycle that passed
 * through it would make everyone who never cancels anything step over it twice
 * per task. It is reached from a menu instead (§18.18 #7).
 *
 * A click on a cancelled item re-opens it (→ todo). The alternative — leaving
 * cancelled off the ring entirely, so a click does nothing — would make the
 * control the one place in the editor that silently ignores a click, and would
 * trap the item in a state only a menu can leave.
 *
 * The price the design accepted: todo → done is two clicks, not one.
 */
export function nextTaskState(state: TaskState): TaskState {
  return CLICK_RING[state];
}

const CLICK_RING: Record<TaskState, TaskState> = {
  cancelled: "todo",
  doing: "done",
  done: "todo",
  todo: "doing",
};
