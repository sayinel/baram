// §3.6 The conflict modal's actions, run against the CONFLICTED tab — not the
// active one. Each returns a result code; `use-conflict-actions.ts` turns codes
// into toasts (`CONFLICT_RESULT_KEYS`).
//
// Shape of a writing action (Apply, Keep Local):
//   take the token → read and check → write (no await between the last check
//   and the write call) → verify the file now holds what was written, and only
//   then acknowledge the pending change and adopt the text into the tab.
// Until that last step the tab stays unsaved and the external-change guard
// stays armed, so neither auto-save can write over the file meanwhile.
import type { MergeSegment } from "../ipc/types";
import type { ConflictEntry } from "../stores/ui/conflict-queue";
import type { UnavailableReason } from "../utils/editor/tab-local-text";
import type { ConflictOp } from "./conflict-op";

import { readFile, writeFile } from "../ipc/invoke";
import { mergeTexts } from "../ipc/snapshot";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { conflictArrival } from "../stores/ui/conflict-queue";
import { useUIStore } from "../stores/ui/ui";
import { awaitBlockIdRenames } from "../utils/editor/block-id-rename-landing";
import { readTabLocalText } from "../utils/editor/tab-local-text";
import { isMarkdownFile } from "../utils/file-type";
import { adoptable, adoptDiskTextIntoTab } from "./conflict-adopt";
import { beginOp, endOp, liveness, readSettled } from "./conflict-op";
import { announceTabWrite, noteTabWritten } from "./tab-write";

export type ConflictFailure =
  | { code: "unavailable"; reason: UnavailableReason }
  | {
      code:
        | "busy"
        | "disk-changed"
        | "local-changed"
        | "merge-failed"
        | "path-changed"
        | "read-failed"
        | "superseded"
        | "tab-gone"
        | "unstable"
        | "write-failed";
    };

export type ConflictFailureCode = ConflictFailure["code"];

/** What a merge view needs — data only; Apply takes its own token. */
export interface PreparedMerge {
  external: string;
  local: string;
  path: string;
  segments: MergeSegment[];
  tabId: string;
}

/**
 * The toast for each failure. `busy` and `tab-gone` say nothing: the first is
 * a button pressed twice, the second has no tab left to talk about.
 */
export const CONFLICT_RESULT_KEYS: Record<
  Exclude<ConflictFailureCode, "busy" | "tab-gone" | "unavailable">,
  string
> = {
  "disk-changed": "conflict.diskChanged",
  "local-changed": "conflict.localChanged",
  "merge-failed": "conflict.mergeFailed",
  "path-changed": "conflict.pathChanged",
  "read-failed": "conflict.readFailed",
  superseded: "conflict.superseded",
  unstable: "conflict.unstable",
  "write-failed": "conflict.writeFailed",
};

/** The toast for an unreadable tab: which way out it has (§3.6 D1). */
export const CONFLICT_UNAVAILABLE_KEYS: Record<UnavailableReason, string> = {
  ambiguous: "conflict.ambiguous",
  binary: "conflict.reloadOnly",
  loading: "conflict.unavailable",
  "no-surface": "conflict.reloadOnly",
  "no-tab": "conflict.unavailable",
  "no-text": "conflict.unavailable",
  "source-unreachable": "conflict.unavailable",
};

/**
 * Write the merged text — only if the disk and the tab still hold what the
 * merge was built from — then verify and adopt it into the tab.
 */
export async function applyConflictMerge(
  prepared: PreparedMerge,
  merged: string,
): Promise<ConflictFailure | { code: "applied" }> {
  const op = beginOp(prepared.tabId, "apply");
  if (typeof op === "string") return { code: op };
  try {
    if (op.path !== prepared.path) return { code: "path-changed" };

    // An event that arrives while this read runs may be a write the read did
    // not see (it can carry an equal or lower mtime, so the queue may not
    // change): refuse rather than write over it.
    const arrival = conflictArrival(op.tabId);
    let disk: string;
    try {
      disk = await readFile(op.path);
    } catch {
      return { code: "read-failed" };
    }
    const gone = liveness(op);
    if (gone) return { code: gone };
    if (conflictArrival(op.tabId) !== arrival || disk !== prepared.external) {
      return { code: "disk-changed" };
    }
    const local = readTabLocalText(op.tabId);
    if (local.kind === "unavailable") {
      useEditorStore.getState().setActiveTab(op.tabId);
      return { code: "unavailable", reason: local.reason };
    }
    if (local.text !== prepared.local) return { code: "local-changed" };
    // Writing with nowhere to install the result would leave the disk and the
    // screen apart, so this is asked before the write, not after. The way out
    // is the same as for a tab still loading: let it settle and Apply again.
    if (!adoptable(op.tabId)) return { code: "unavailable", reason: "loading" };

    const written = await writeTab(op, merged);
    if (typeof written !== "number") return written;
    const verified = await verifyAndAcknowledge(op, merged, written, () => {
      const now = readTabLocalText(op.tabId);
      // Text that changed while the write ran (a block ID landing, a task
      // write) is not in `merged`. Queue the conflict again against what the
      // merge assumed, and acknowledge nothing: the guard keeps the auto-save
      // from writing the new local text over the merge.
      if (
        now.kind !== "text" ||
        now.text !== prepared.local ||
        !adoptable(op.tabId)
      ) {
        requeue(op, prepared.local);
        return { code: "local-changed" };
      }
      return () => {
        adoptDiskTextIntoTab(op.tabId, op.path, merged);
      };
    });
    return verified ?? { code: "applied" };
  } finally {
    endOp(op);
  }
}

/**
 * Keep the tab's own text: write it, verify, and mark the tab saved only if
 * its text did not change while the write ran.
 */
export async function keepLocalForConflict(
  entry: ConflictEntry,
): Promise<ConflictFailure | { code: "saved" }> {
  const op = beginOp(entry.tabId, "keep-local");
  if (typeof op === "string") return { code: op };
  try {
    await awaitBlockIdRenames(op.tabId);
    const gone = liveness(op);
    if (gone) return { code: gone };
    const local = readTabLocalText(op.tabId);
    if (local.kind === "unavailable") {
      useEditorStore.getState().setActiveTab(op.tabId);
      return { code: "unavailable", reason: local.reason };
    }

    const written = await writeTab(op, local.text);
    if (typeof written !== "number") return written;
    const verified = await verifyAndAcknowledge(op, local.text, written, () => {
      return () => {
        const now = readTabLocalText(op.tabId);
        // Edits made while the write ran are not on disk: the tab stays unsaved.
        if (now.kind !== "text" || now.text !== local.text) return;
        useFileStore.getState().setFileContent(op.path, local.text);
        useEditorStore.getState().markDirty(op.tabId, false);
        useEditorStore.getState().markSourceEdited(op.tabId, false);
      };
    });
    return verified ?? { code: "saved" };
  } finally {
    endOp(op);
  }
}

/**
 * Read the tab's text and the disk's and build the merge, for the merge view.
 * Holds the token only while it runs; the result is plain data.
 */
export async function prepareConflictMerge(
  entry: ConflictEntry,
): Promise<ConflictFailure | { code: "prepared"; prepared: PreparedMerge }> {
  const op = beginOp(entry.tabId, "prepare");
  if (typeof op === "string") return { code: op };
  try {
    await awaitBlockIdRenames(op.tabId);
    let gone = liveness(op);
    if (gone) return { code: gone };
    const local = readTabLocalText(op.tabId);
    if (local.kind === "unavailable") {
      useEditorStore.getState().setActiveTab(op.tabId);
      return { code: "unavailable", reason: local.reason };
    }
    let external: string;
    try {
      external = await readFile(op.path);
    } catch {
      return { code: "read-failed" };
    }
    gone = liveness(op);
    if (gone) return { code: gone };
    let segments: MergeSegment[];
    try {
      segments = (await mergeTexts(entry.base, local.text, external)).segments;
    } catch {
      return { code: "merge-failed" };
    }
    gone = liveness(op);
    if (gone) return { code: gone };
    return {
      code: "prepared",
      prepared: {
        external,
        local: local.text,
        path: op.path,
        segments: requireChoiceForExternalHunks(segments),
        tabId: op.tabId,
      },
    };
  } finally {
    endOp(op);
  }
}

/**
 * §3.6 D3 (interim) Turn every one-sided EXTERNAL hunk into a choice.
 *
 * The merge base is the cached text at the time of the event, and for a
 * background tab with unsaved work that is often the tab's own unsaved text
 * (leaving a tab writes it into `openFiles`). Then base equals local, the merge
 * sees no local hunks, and every external hunk would be applied silently —
 * Apply enabled at once, the local edits gone without a choice. Making each
 * external hunk a conflict whose local side is the base text asks instead.
 * Local hunks stay automatic.
 *
 * Remove once the merge base is the text last synced with the disk (PR 2): the
 * done condition there is that this function is gone and the fixtures in
 * `src-tauri/src/snapshot/fixtures/merge-outputs.json` no longer lose local
 * text with the real ancestor.
 */
export function requireChoiceForExternalHunks(
  segments: readonly MergeSegment[],
): MergeSegment[] {
  return segments.map((seg) =>
    seg.kind === "external"
      ? {
          base: seg.base,
          external: seg.external,
          kind: "conflict",
          local: seg.base,
        }
      : seg,
  );
}

function requeue(op: ConflictOp, base: string): void {
  const entry = useUIStore
    .getState()
    .conflictQueue.find((e) => e.tabId === op.tabId);
  useUIStore.getState().enqueueConflict({
    base,
    externalMtime: entry?.externalMtime ?? 0,
    filePath: op.path,
    tabId: op.tabId,
  });
}

/**
 * After a write: read the file until the read is settled (`readSettled` — no
 * event arrived during it, or it matches the read before), and acknowledge only
 * when it holds `expected`.
 *
 * `prepareAdopt` runs in the synchronous section before anything is
 * acknowledged; it returns a failure to stop there, or the adopt step. Then, in
 * one synchronous run: note the write (echo cutoff = `savedAt`, the time
 * observed right after the write — never a future time), acknowledge the
 * pending event (`canReloadMtime = 0`), adopt, announce, and resolve the
 * conflict generation current at that moment.
 *
 * @returns null when acknowledged, otherwise the failure.
 */
async function verifyAndAcknowledge(
  op: ConflictOp,
  expected: string,
  savedAt: number,
  prepareAdopt: () => (() => void) | ConflictFailure,
): Promise<ConflictFailure | null> {
  const read = await readSettled(op);
  if ("code" in read) return read;
  if (read.text !== expected) return { code: "superseded" };

  const adopt = prepareAdopt();
  if (typeof adopt !== "function") return adopt;
  // The generation now: every event up to the settled read is covered by it.
  const generation = useUIStore.getState().conflictGeneration(op.tabId);
  noteTabWritten(op.path, savedAt);
  useFileStore.getState().updateCanReloadMtime(op.path, 0);
  adopt();
  announceTabWrite(op.path, { indexLinks: isMarkdownFile(op.path) });
  if (generation !== null) {
    useUIStore.getState().resolveConflict(op.tabId, generation);
  }
  return null;
}

/**
 * Write `text` to the op's path. Callers check `liveness` with no await between
 * that check and this call. Returns the time observed right after the write —
 * the echo cutoff — or why nothing was written.
 */
async function writeTab(
  op: ConflictOp,
  text: string,
): Promise<ConflictFailure | number> {
  try {
    await writeFile(op.path, text);
  } catch {
    return { code: "write-failed" };
  }
  return Date.now();
}
