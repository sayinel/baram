// §3.6 The lifetime of one conflict action — the execution token.
//
// One action runs at a time. It is bound to a tab id AND the path that tab had
// when the action began: every await may let the tab close or be renamed, and
// writing after either would land on a file the user did not agree to change.
// The four actions (prepare, apply and keep-local in `conflict-resolution.ts`,
// reload in `conflict-reload.ts`) ask `liveness` before they use what an await
// returned, and the two that write ask it with no await between that check and
// the write.
import { useEditorStore } from "../stores/editor/editor";
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
