// §3.6 The lifetime of one conflict action — the execution token.
//
// One action runs at a time. It is bound to a tab id AND the path that tab had
// when the action began: every await may let the tab close or be renamed, and
// writing after either would land on a file the user did not agree to change.
// The four actions (prepare, apply and keep-local in `conflict-resolution.ts`,
// reload in `conflict-reload.ts`) ask `liveness` before they use what an await
// returned, and the two that write ask it with no await between that check and
// the write.
import { readFile } from "../ipc/invoke";
import { useEditorStore } from "../stores/editor/editor";
import { conflictArrival } from "../stores/ui/conflict-queue";
import { useUIStore } from "../stores/ui/ui";

export interface ConflictOp {
  readonly id: number;
  readonly kind: ConflictOpKind;
  readonly path: string;
  readonly tabId: string;
}

export type ConflictOpKind = "apply" | "keep-local" | "prepare" | "reload";

/** Why an action stopped after an await: the tab closed, or it moved. */
export type Liveness = "path-changed" | "tab-gone" | null;

/** A read of the op's file that no watcher event can be shown to postdate. */
export interface SettledRead {
  /** `Date.now()` right before the read that was accepted. */
  startedAt: number;
  text: string;
}

const SETTLE_ATTEMPTS = 3;

let current: ConflictOp | null = null;
let lastId = 0;

/**
 * Take the token for a tab, binding the tab's current path. `busy` while
 * another action holds it; `tab-gone` when the tab no longer exists (its
 * conflict is dropped).
 */
export function beginOp(
  tabId: string,
  kind: ConflictOpKind,
): "busy" | "tab-gone" | ConflictOp {
  if (current) return "busy";
  const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab) {
    useUIStore.getState().dropConflict(tabId);
    return "tab-gone";
  }
  current = { id: ++lastId, kind, path: tab.filePath, tabId };
  return current;
}

/** Release the token — only the holder can. The four actions call it in `finally`. */
export function endOp(op: ConflictOp): void {
  if (current === op) current = null;
}

/**
 * `null` while the action may go on: it still holds the token, its tab exists,
 * and the tab is still on the bound path. A gone tab also drops its conflict.
 */
export function liveness(op: ConflictOp): Liveness {
  if (current !== op) return "tab-gone";
  const tab = useEditorStore.getState().tabs.find((t) => t.id === op.tabId);
  if (!tab) {
    useUIStore.getState().dropConflict(op.tabId);
    return "tab-gone";
  }
  return tab.filePath === op.path ? null : "path-changed";
}

/**
 * Read the op's file until the read can be trusted to be current: no watcher
 * arrival for the tab during it (`conflictArrival` — every event counts, also
 * the ones the queue folds away), or the same text as the read before it. The
 * second rule lets the several events of ONE write (macOS sends created and
 * changed) settle instead of reading as instability. Gives up after three reads.
 */
export async function readSettled(
  op: ConflictOp,
): Promise<
  | SettledRead
  | { code: "path-changed" | "read-failed" | "tab-gone" | "unstable" }
> {
  let previous: null | string = null;
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
    const startedAt = Date.now();
    const arrival = conflictArrival(op.tabId);
    let text: string;
    try {
      text = await readFile(op.path);
    } catch {
      return { code: "read-failed" };
    }
    const gone = liveness(op);
    if (gone) return { code: gone };
    if (conflictArrival(op.tabId) === arrival || text === previous) {
      return { startedAt, text };
    }
    previous = text;
  }
  return { code: "unstable" };
}
