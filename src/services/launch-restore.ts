// §81 The launch restore's choices: which context the app opens on, and the file it
// shows there. `useAppStartup` (hooks/use-app-startup.ts) calls these after it has
// re-registered the persisted contexts in Rust, in this order:
//   restoreSeat → openRestoredContext → the space startups → openRestoredFile.
//
// They decide the seat (the vault tab), the file tree and the active tab together;
// when the restore settles all three name the same context — for a file outside
// every vault and folder, its §89 FileContext, which has no tree. The space startups
// in between register their contexts with `activate: false` and open their notes
// behind the restored tab.
//
// The fallbacks log with `logger.error`, not `warn`: `warn` writes only in dev builds
// (`utils/logger.ts`), and a restore that quietly opened something other than what
// the user asked for must leave a trace in a release build.
import type { ContextInfo } from "../ipc/types";

import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import { logger } from "../utils/logger";
import { openFolder, switchContext } from "./vault-context-loader";

/**
 * The context the restore opens on: the persisted active one when Rust holds it
 * this session, otherwise the first context in tab order that Rust holds. Null —
 * the caller then takes the legacy path — when no context is active, or none is
 * held.
 *
 * ‼️ "Holds this session" (`registered`) and not "persisted": the launch registers
 * only the contexts already approved, plus the active one (§334). When the active
 * one was dropped as unresolvable, `removeContext` hands the seat to the first
 * context in the list — a pinned space tab, possibly one the launch skipped — and
 * opening that would raise the approval dialog for a context the user was not on.
 */
export function restoreSeat(
  registered: ReadonlySet<string>,
): ContextInfo | null {
  const { activeContext, contexts } = useContextStore.getState();
  const active = activeContext();
  if (!active) return null;
  if (registered.has(active.id)) return active;
  const held = contexts.find((c) => registered.has(c.id)) ?? null;
  logger.error(
    `§81 The last active context is not registered this session — restoring ` +
      `${held ? `${held.label} (${held.path})` : "no context"} instead: ` +
      `${active.label} (${active.path})`,
  );
  return held;
}

/**
 * Open the context the restore lands in — seat, Rust's root and file tree
 * together — and return the file to activate there, or null.
 *
 * `lastFile` is passed only for On Launch = "Restore last file". It picks the
 * context: the vault or folder that holds it, or — for a file outside every one of
 * them — `seat`, the file then opening in a §89 FileContext of its own. Otherwise,
 * and whenever the file's context cannot be switched to, it is `seat`, no file.
 */
export async function openRestoredContext(
  seat: ContextInfo,
  lastFile: null | string,
  registered: ReadonlySet<string>,
): Promise<null | string> {
  const home = lastFile
    ? useContextStore.getState().getContextForPath(lastFile)
    : null;
  if (!home || home.id === seat.id) {
    await openFolder(seat.path);
    return lastFile;
  }
  // §334 Only the active context may raise the approval dialog at launch. A
  // context the launch skipped (not approved yet) or failed to register is not
  // one to switch to now.
  if (!registered.has(home.id)) {
    logger.error(
      `§81 Last file's context is not registered this session — restoring ` +
        `the last folder instead: ${home.label} (${home.path})`,
    );
    await openFolder(seat.path);
    return null;
  }
  // The tab bar's full switch — seat, Rust's root, tree and link index.
  try {
    await switchContext(home.id);
  } catch (err) {
    // The tree load failed (`_loadContextFileTree` rethrows after reporting it).
    // The seat is already on `home`; the fallback below takes it back.
    logger.error(
      `§81 Could not load the last file's context — restoring the last ` +
        `folder instead: ${home.label} (${home.path})`,
      err,
    );
    await openFolder(seat.path);
    return null;
  }
  if (useContextStore.getState().activeContextId === home.id) return lastFile;
  // §333 A refused switch puts the seat back without loading anything.
  logger.error(
    `§81 Could not switch to the last file's context — restoring the last ` +
      `folder instead: ${home.label} (${home.path})`,
  );
  await openFolder(seat.path);
  return null;
}

/**
 * Activate the restored file. One that does not open (deleted, unreadable —
 * `handleOpenFilePath` logs and returns) leaves the launch where "Restore last
 * folder" would: on `seat`, which `openRestoredContext` or the failed open may
 * have switched away from, without a FileContext the failed open created for it.
 */
export async function openRestoredFile(
  file: string,
  seat: ContextInfo,
  handleOpenFilePath: (path: string) => Promise<void>,
): Promise<void> {
  const fileContextsBefore = new Set(
    useContextStore
      .getState()
      .contexts.filter((c) => c.contextType === "file")
      .map((c) => c.id),
  );
  await handleOpenFilePath(file);
  const { activeTabId, tabs } = useEditorStore.getState();
  if (tabs.find((t) => t.id === activeTabId)?.filePath === file) return;

  logger.error(
    `§81 Last file could not be opened — restoring the last folder: ${file}`,
  );
  if (useContextStore.getState().activeContextId !== seat.id) {
    await openFolder(seat.path);
  }
  // §89 `openFileByPath` creates (and switches to) a FileContext for an external
  // file BEFORE reading it, so a file that exists but cannot be read leaves one
  // behind with no tab — a context tab that opens nothing. Only one the failed
  // open created goes, and only while no tab holds it.
  const stray = useContextStore
    .getState()
    .contexts.filter(
      (c) =>
        c.contextType === "file" &&
        !fileContextsBefore.has(c.id) &&
        !tabs.some((t) => t.contextId === c.id),
    );
  for (const ctx of stray) {
    await useContextStore
      .getState()
      .removeContext(ctx.id)
      .catch(() => {});
  }
}
