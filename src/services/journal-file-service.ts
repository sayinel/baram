// §56 Journal file service — shared open/create logic across journal entry points
import { isFileNotFoundError } from "../ipc/fs";
import { createDir, readFile, writeFile } from "../ipc/invoke";
import { useContextStore } from "../stores/context/context";
import { useEditorStore } from "../stores/editor/editor";
import { useFileStore } from "../stores/file/file";
import { useSettingsStore } from "../stores/settings/store";
import { maybeRefreshForPath } from "../stores/zettelkasten/zettel-index";
import {
  applyJournalTemplate,
  generateDefaultJournal,
  getHierarchicalJournalPath,
  getJournalFilePath,
  resolveJournalDir,
} from "../utils/journal/journal";
import {
  notifyJournalChanged,
  requestJournalBodyCursor,
} from "../utils/journal/journal-events";
import { applyPeriodicTemplate } from "../utils/journal/journal-periodic";
import { logger } from "../utils/logger";
import { basename } from "../utils/path-utils";
import { resolveZettelDir } from "../utils/zettelkasten/zettelkasten";
import { reportSpaceDirectoryTaken } from "./space-context-migration";

export interface JournalFileOptions {
  /**
   * §317 Asked ONLY when the entry does not exist yet and is about to be
   * created. Return false to leave the disk untouched (the call then resolves
   * to null, exactly as an unresolvable directory does).
   *
   * ‼️ A callback, not a flag, so this service never imports a dialog — the
   * confirm UI stays in the caller's layer.
   *
   * Omitted (the default) means create without asking. Five of the six callers
   * omit it — the journal space's startup and new-entry flow, the calendar's day
   * click, the open-today command (`use-keybinding-actions.ts`) and `useJournal`'s
   * automatic creation — each a request to make the entry. Only date-wikilink
   * navigation (`use-navigation.ts`) passes it: a *link click* is a reference that
   * should not create.
   */
  confirmCreate?: () => Promise<boolean>;
  journalDirectory: string;
  journalFilenameFormat: string;
  journalTemplatePath: null | string | undefined;
  journalUseHierarchy: boolean;
  rootPath?: null | string;
}

/**
 * Make the journal directory known to the backend before any filesystem call on it.
 *
 * `resolveJournalDir` accepts absolute paths only, so the journal directory can sit
 * outside the open vault, and there `check_vault` permits nothing until the journal
 * context exists (the Rust ContextManager is in-memory; startup re-registers only the
 * contexts the store already persisted). `ensureJournalFile` reads and writes under this
 * directory for each of its six callers (the journal space's startup and new-entry flow,
 * `CalendarPanel`, `use-journal.ts`, `use-keybinding-actions.ts`, `use-navigation.ts`).
 * Before it registered here, four of the five callers of the time skipped registration —
 * the shortcut, the calendar, date-wikilink navigation and the startup hook — each failing
 * identically: readFile denied, read as "no such file", createDir denied, swallowed by the
 * caller's catch. Only the journal space registered. (Another, the §56b Alt+←/→ day
 * navigation, skipped it too; it sat behind §37's Alt+←/→ branch in the same keydown
 * handler and has been removed. CalendarPanel's periodic notes write here without
 * `ensureJournalFile` and call `ensureJournalDirRegistered` themselves.)
 *
 * ‼️ Registers WITHOUT activating. `ensureSpaceContext` used to activate
 * unconditionally, and the subscription in `stores/file/file.ts` syncs `rootPath`
 * without loading the tree (the zettel preset compensates with an explicit
 * `switchContext`) — so activating from here would repoint `rootPath` at the journal
 * while the sidebar still showed the previous vault, and "New file" in that tree would
 * write into the journal directory. Switching spaces stays the preset's job.
 *
 * A failure is swallowed on purpose — the following filesystem call then produces the
 * real error instead of being masked by a context error — but it is logged with
 * `logger.error`, not `warn`: `warn` is gated on `import.meta.env.DEV`, so a warn-only
 * fallback records NOTHING in a release build. That is the very argument the sibling
 * commit made about the no-op backend logger, and it applies here too. ‼️ Known gap: the
 * backend refuses to register a path that does not exist, so a journal directory that
 * was deleted, renamed or lives on an unmounted volume still ends in the silent no-op
 * described above — the write cannot create it either. Tracked in dev/backlog.md.
 *
 * §89 note: creating the context here can bring back a journal context the user closed.
 * That is accepted for EXPLICIT requests (a calendar day, a date wikilink, the shortcut):
 * a write outside the vault requires a registered context, so refusing would
 * mean refusing what the user just asked for. Activation is what made the old behaviour
 * intrusive, and that is gone. The automatic paths keep their own §89 guards and check
 * `journalContext()` before calling in (`use-journal.ts`, `spaces/journal-space.ts`).
 */
export async function ensureJournalDirRegistered(
  journalDir: string,
): Promise<boolean> {
  try {
    await useContextStore
      .getState()
      .ensureJournalContext(journalDir, { activate: false });
    return true;
  } catch (err) {
    // issue 598: a directory already held by another context is terminal —
    // the user has just been told the Journal directory was left unchanged,
    // so writing an entry there anyway (Rust would allow it: that other
    // context covers the path) would contradict the toast. Any other failure
    // keeps today's behaviour: the filesystem produces the real error.
    if (reportSpaceDirectoryTaken(err)) return false;
    logger.error("[journal] journal context registration failed:", err);
    return true;
  }
}

/**
 * Ensures a journal file for the given date exists (creating it from template
 * or default content if needed) and returns the resolved path and content.
 *
 * Does NOT open a tab — the caller decides what to do with the file.
 *
 * Returns null if the path cannot be resolved, or if the journal directory is
 * held by another context (the user has been told; see
 * `ensureJournalDirRegistered`).
 */
export async function ensureJournalFile(
  date: Date,
  options: JournalFileOptions,
): Promise<null | { content: string; path: string }> {
  const {
    confirmCreate,
    journalDirectory,
    journalFilenameFormat,
    journalTemplatePath,
    journalUseHierarchy,
    rootPath,
  } = options;

  const resolved = resolveJournalDir(rootPath ?? null, journalDirectory);
  if (!resolved) return null;

  if (!(await ensureJournalDirRegistered(resolved))) return null;

  const journalPath = journalUseHierarchy
    ? getHierarchicalJournalPath(resolved, date, journalFilenameFormat)
    : getJournalFilePath(
        rootPath ?? null,
        journalDirectory,
        date,
        journalFilenameFormat,
      );
  if (!journalPath) return null;

  let content: string;
  try {
    content = await readFile(journalPath);
  } catch (err) {
    // Only "no such file" means create. An entry that exists but could not be read
    // (invalid UTF-8, a permission the OS refused) used to land here too, and the
    // template was written over it — the §277 defect the PDF companion note closed with
    // this same check. Raise it instead and leave the disk as it was: each of the six
    // callers catches it — the journal space's `newFileFlow` through its own caller in
    // `stores/file/workspace.ts`. The rejection may name an OS error but not the file
    // (a `check_vault` refusal reaches here too, with no entry behind it), so the log
    // names the path and says only that nothing was written.
    if (!isFileNotFoundError(err)) {
      logger.error(
        `[journal] reading the journal entry failed other than "not found"; nothing was written: ${journalPath}`,
        err,
      );
      throw err;
    }
    // File doesn't exist — create it.
    // §317 …unless the caller wants to ask first. The gate sits HERE, after the
    // read found no file, so an entry that already exists is opened without a
    // prompt: following a reference must never interrogate the user.
    if (confirmCreate && !(await confirmCreate())) return null;

    const parentDir = journalPath.substring(0, journalPath.lastIndexOf("/"));
    await createDir(parentDir);

    if (journalTemplatePath) {
      try {
        const tpl = await readFile(journalTemplatePath);
        content = applyJournalTemplate(tpl, date);
      } catch {
        content = generateDefaultJournal(date);
      }
    } else {
      content = generateDefaultJournal(date);
    }

    await writeFile(journalPath, content);

    // A new entry now exists on disk — refresh the calendar dots / Memories,
    // and ask the editor to drop the caret on a body line below the date title
    // once this template loads (§56 journal-events).
    notifyJournalChanged();
    requestJournalBodyCursor(journalPath);
  }

  return { path: journalPath, content };
}

/**
 * §56f The periodic note at `notePath` (the calendar's weekly note): its content, created
 * from `templatePath` — or from `generate` when there is no template or it cannot be read —
 * when the note does not exist yet.
 *
 * The same read classification as {@link ensureJournalFile}, for the same reason: only
 * "no such file" creates. Any other read failure — a note that exists but cannot be read,
 * or a refused path — is raised, and nothing is written. The caller registers the journal directory first
 * ({@link ensureJournalDirRegistered}); this does the filesystem work only.
 */
export async function ensurePeriodicNote(
  notePath: string,
  date: Date,
  generate: (date: Date) => string,
  templatePath?: string,
): Promise<string> {
  try {
    return await readFile(notePath);
  } catch (err) {
    if (!isFileNotFoundError(err)) {
      logger.error(
        `[journal] reading the periodic note failed other than "not found"; nothing was written: ${notePath}`,
        err,
      );
      throw err;
    }
  }

  await createDir(notePath.substring(0, notePath.lastIndexOf("/"))).catch(
    () => {},
  );
  let content: string;
  if (templatePath) {
    try {
      content = applyPeriodicTemplate(await readFile(templatePath), date);
    } catch {
      content = generate(date);
    }
  } else {
    content = generate(date);
  }
  await writeFile(notePath, content);
  return content;
}

/**
 * Opens a file in the editor tab bar.
 * If the file is already open, activates its existing tab.
 *
 * §81 `activate: false` opens it behind the active tab and leaves an open one where
 * it is (see `openTab`). `contextId` names the context the tab belongs to — an
 * already-open tab is moved to it too; omitted, a new tab gets whichever context
 * holds the seat (`openTab`) and an open one keeps its own.
 */
export async function openFileInTab(
  filePath: string,
  content: string,
  opts?: { activate?: boolean; contextId?: string },
): Promise<void> {
  const activate = opts?.activate !== false;
  const edStore = useEditorStore.getState();
  const existing = edStore.tabs.find((t) => t.filePath === filePath);
  if (existing) {
    // Only update the file content store when the tab is not dirty.
    // If the tab has unsaved edits, keep the user's in-progress changes.
    if (!existing.isDirty) {
      useFileStore.getState().setFileContent(filePath, content);
    }
    // Before activating: `setActiveTab` switches by the tab's context.
    if (opts?.contextId && existing.contextId !== opts.contextId) {
      edStore.setTabContexts(new Map([[existing.id, opts.contextId]]));
    }
    if (activate) edStore.setActiveTab(existing.id);
  } else {
    useFileStore.getState().setFileContent(filePath, content);
    edStore.openTab(
      {
        contextId: opts?.contextId ?? "",
        id: crypto.randomUUID(),
        filePath,
        title: basename(filePath) || "Journal",
        isDirty: false,
        isPinned: false,
      },
      { activate },
    );
  }

  // Seed the self-write baseline so the creation/open echo from the watcher
  // (and this app's own subsequent saves) are not mistaken for external
  // changes. Without this, a just-created/opened note's writeFile echo trips
  // the conflict/auto-reload path. (use-file-watcher.ts self-write guard.)
  useFileStore.getState().updateLastSaveMtime(filePath, Date.now());

  // §95 M2: populate the zettel id index when opening a note under the
  // zettel space, even if it was reached without activating the
  // "zettelkasten" workspace preset. No-op for non-zettel paths (see
  // maybeRefreshForPath) — cheap for the common (non-zettel) case.
  const { zettelkastenDirectory } = useSettingsStore.getState();
  const { rootPath } = useFileStore.getState();
  maybeRefreshForPath(
    filePath,
    resolveZettelDir(rootPath, zettelkastenDirectory),
  ).catch(() => {});
}
