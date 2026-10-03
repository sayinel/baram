// Regression test: openFileInTab must seed the self-write mtime baseline so
// the creation/open echo from the file watcher isn't mistaken for an
// external change (see use-file-watcher.ts self-write guard).
import { beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above top-level consts, so the mocked fns
// must be created via vi.hoisted() to be safely referenced inside them.
// Every mock appends to `calls` because the registration defect below is an
// ORDERING one: registering after the first filesystem call is no fix at all.
const { calls, createDir, ipcAddContext, listDir, readFile, writeFile } =
  vi.hoisted(() => {
    const calls: string[] = [];
    return {
      calls,
      createDir: vi.fn(async () => {
        calls.push("createDir");
      }),
      ipcAddContext: vi.fn(async (info: unknown) => {
        calls.push("add_context");
        return info;
      }),
      listDir: vi.fn(async () => {
        calls.push("listDir");
        return [];
      }),
      readFile: vi.fn(async () => {
        calls.push("readFile");
        return "";
      }),
      writeFile: vi.fn(async () => {
        calls.push("writeFile");
      }),
    };
  });
vi.mock("../../ipc/invoke", () => ({
  listDir,
  readFile,
  createDir,
  writeFile,
}));
// All six exports the context store imports. A partial mock leaves the rest
// `undefined`, and the try/catch this service added would swallow the resulting
// TypeError — a programming error passing as green.
vi.mock("../../ipc/context", () => ({
  addContext: ipcAddContext,
  getContexts: vi.fn(async () => []),
  removeContext: vi.fn(async () => {}),
  setActiveContext: vi.fn(async () => {}),
  updateContextAlias: vi.fn(async () => {}),
  updateContextColor: vi.fn(async () => {}),
  updateContextLabel: vi.fn(async () => {}),
}));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({ logger }));

import type { ContextInfo } from "../../ipc/types";

import { useContextStore } from "../../stores/context/context";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useUIStore } from "../../stores/ui/ui";
import { getWeeklyJournalPath } from "../../utils/journal/journal";
import {
  ensureJournalFile,
  ensurePeriodicNote,
  openFileInTab,
} from "../journal-file-service";

describe("openFileInTab", () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  });

  it("§81 gives an already-open tab the context it is asked to open in", async () => {
    // The Zettel preset brings a home note that is already open (from the
    // launch, tagged with the folder holding it) to the front in its own space.
    useEditorStore.setState({
      activeTabId: null,
      tabs: [
        {
          contextId: "ctx-work",
          filePath: "/work/home.md",
          id: "t-home",
          isDirty: false,
          isPinned: false,
          title: "home.md",
        },
      ],
    });

    await openFileInTab("/work/home.md", "# Home", {
      activate: false,
      contextId: "ctx-zettel",
    });

    expect(useEditorStore.getState().tabs[0]).toMatchObject({
      contextId: "ctx-zettel",
    });
  });

  it("seeds the self-write baseline (lastSaveMtime) for a newly opened file", async () => {
    const filePath = "/vault/notes/202601010000 X.md";
    await openFileInTab(filePath, "# X");

    const mtimeEntry = useFileStore.getState().getFileMtime(filePath);
    expect(mtimeEntry?.lastSaveMtime).toBeGreaterThan(0);
  });
});

// §85/§88 — the journal directory must be a registered context before any
// filesystem call, or the Rust side denies it.
//
// `resolveJournalDir` only accepts ABSOLUTE paths, so the journal directory can sit
// outside the open vault. `check_vault` then permits nothing there until the journal
// context exists (the ContextManager is in-memory; startup re-registers only the
// contexts the store already persisted). FOUR of the five `ensureJournalFile` call sites
// skipped it — the shortcut (`use-keybinding-actions.ts`), the calendar
// (`CalendarPanel.tsx`), date-wikilink navigation (`use-navigation.ts`) and the startup
// hook (`use-journal.ts`); only the journal space (`spaces/journal-space.ts`) registered.
// (A sixth, the §56b Alt+←/→ day navigation, skipped it too and has since been removed.)
// So on first use from any of them, `readFile` was denied, this service read that as
// "file does not exist", `createDir` was denied too, and every caller's catch swallowed
// it: a silent no-op that healed itself only once the user had entered the journal
// space at least once.
// (CalendarPanel's periodic notes — weekly/monthly/yearly — do their own filesystem
// work and call `ensureJournalDirRegistered` directly for the same reason.)
const JOURNAL_DIR = "/tmp/baram-journal-test";
const OPTIONS = {
  journalDirectory: JOURNAL_DIR,
  journalFilenameFormat: "YYYY-MM-DD",
  journalTemplatePath: null,
  journalUseHierarchy: false,
  rootPath: "/vault",
};
const DATE = new Date(2026, 7, 8);

// What Tauri actually rejects `readFile` with: the command's error STRING, the Display of
// `FsError` (`src-tauri/src/fs/mod.rs`). A missing file and an unreadable one are two
// different strings there, and this service must not read them alike — the Rust test
// `not_found_display_prefix_is_what_the_frontend_parses` pins the first prefix.
// `OPTIONS` formats the filename without an extension, so the entry has none either.
const ENTRY = `${JOURNAL_DIR}/2026-08-08`;
const NOT_FOUND = `파일을 찾을 수 없습니다: ${ENTRY}`;
const UNREADABLE = "파일 읽기 실패: stream did not contain valid UTF-8";

function journalContext(): ContextInfo {
  return {
    addedAt: Date.now(),
    color: "#10b981",
    contextType: "vault",
    id: "ctx-journal",
    label: "journal",
    path: JOURNAL_DIR,
    vaultType: "journal",
  };
}

describe("ensureJournalFile — journal directory registration", () => {
  beforeEach(() => {
    calls.length = 0;
    ipcAddContext.mockClear();
    readFile.mockClear();
    useContextStore.setState({ activeContextId: null, contexts: [] });
    useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  });

  it("registers the journal directory before the first filesystem call", async () => {
    // The create branch: no entry on disk yet, which is the first-use case.
    readFile.mockRejectedValueOnce(NOT_FOUND);

    const result = await ensureJournalFile(DATE, OPTIONS);

    expect(calls[0]).toBe("add_context");
    // …and that it registered THIS directory as the journal — "some context was
    // registered" would pass for any path, including the vault that was already there.
    expect(ipcAddContext).toHaveBeenCalledWith(
      expect.objectContaining({ path: JOURNAL_DIR, vaultType: "journal" }),
    );
    expect(calls).toContain("writeFile");
    expect(result).not.toBeNull();
  });

  it("registers without activating, leaving the workspace where it was", async () => {
    // ‼️ Activating here would repoint `rootPath` at the journal while the sidebar still
    // showed the previous vault (the file.ts subscription syncs rootPath only, and does
    // not load the tree), so "New file" in that tree would write into the journal
    // directory. Switching spaces is the preset's job, not this service's.
    const vault: ContextInfo = {
      addedAt: Date.now(),
      color: "#3b82f6",
      contextType: "vault",
      id: "ctx-vault",
      label: "vault",
      path: "/vault",
    };
    useContextStore.setState({ activeContextId: vault.id, contexts: [vault] });

    await ensureJournalFile(DATE, OPTIONS);

    expect(ipcAddContext).toHaveBeenCalledTimes(1);
    expect(useContextStore.getState().activeContextId).toBe(vault.id);
  });

  it("does not register a second context when the journal one already exists", async () => {
    const existing = journalContext();
    useContextStore.setState({
      activeContextId: existing.id,
      contexts: [existing],
    });

    await ensureJournalFile(DATE, OPTIONS);

    expect(ipcAddContext).not.toHaveBeenCalled();
  });

  it("does not touch the disk when the journal directory is held by another context", async () => {
    // issue 598: the user has just been told the Journal directory was left
    // unchanged; writing today's entry into that directory anyway — Rust would
    // allow it, the other context covers the path — would contradict the toast.
    const vault: ContextInfo = {
      addedAt: Date.now(),
      color: "#3b82f6",
      contextType: "vault",
      id: "ctx-vault",
      label: "vault",
      path: JOURNAL_DIR,
    };
    useContextStore.setState({ activeContextId: vault.id, contexts: [vault] });
    // The backend dedups by canonical path and answers with the vault itself.
    ipcAddContext.mockImplementationOnce(async () => {
      calls.push("add_context");
      return vault;
    });
    const toast = vi.spyOn(useUIStore.getState(), "showToast");
    logger.error.mockClear();

    const result = await ensureJournalFile(DATE, OPTIONS);

    expect(result).toBeNull();
    // Registration was attempted, and nothing touched the disk after it.
    expect(calls).toEqual(["add_context"]);
    expect(toast).toHaveBeenCalledWith(
      expect.stringContaining(JOURNAL_DIR),
      "error",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("still opens the entry when registration fails, and says so where release builds can see it", async () => {
    // Registration is a precondition, not the caller's business: if it fails, let the
    // filesystem produce the real error instead of masking it with a context error.
    // But it must be recorded with `error`, not `warn` — `logger.warn` is gated on
    // `import.meta.env.DEV`, so a warn-only fallback records nothing in a release build
    // (the same class this branch called out about the no-op backend logger).
    logger.error.mockClear();
    logger.warn.mockClear();
    ipcAddContext.mockRejectedValueOnce(
      new Error("Path does not exist: /tmp/baram-journal-test"),
    );

    const result = await ensureJournalFile(DATE, OPTIONS);

    expect(result).not.toBeNull();
    expect(calls).toContain("readFile");
    expect(logger.error).toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

// §317 defect B — following a reference must not silently author a diary entry.
//
// The gate sits AFTER the read fails, which is what separates "reference" from
// "create": an entry that already exists opens with no prompt at all.
describe("ensureJournalFile — confirmCreate (§317)", () => {
  beforeEach(() => {
    calls.length = 0;
    ipcAddContext.mockClear();
    readFile.mockClear();
    writeFile.mockClear();
    createDir.mockClear();
    useContextStore.setState({
      activeContextId: "ctx-journal",
      contexts: [journalContext()],
    });
    useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  });

  it("creates without asking when no callback is given", async () => {
    // The invariant that keeps the three existing callers untouched: the
    // journal space's startup, the calendar, and the command palette all mean
    // "make today's entry" and must not grow a dialog.
    readFile.mockRejectedValueOnce(NOT_FOUND);

    const result = await ensureJournalFile(DATE, OPTIONS);

    expect(calls).toContain("writeFile");
    expect(result).not.toBeNull();
  });

  it("does not touch the disk when the callback declines", async () => {
    readFile.mockRejectedValueOnce(NOT_FOUND);
    const confirmCreate = vi.fn(async () => false);

    const result = await ensureJournalFile(DATE, { ...OPTIONS, confirmCreate });

    expect(confirmCreate).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
    // Both, not just writeFile: createDir would leave an empty journal folder
    // behind for a date the user explicitly refused to create.
    expect(calls).not.toContain("writeFile");
    expect(calls).not.toContain("createDir");
  });

  it("creates when the callback accepts", async () => {
    readFile.mockRejectedValueOnce(NOT_FOUND);
    const confirmCreate = vi.fn(async () => true);

    const result = await ensureJournalFile(DATE, { ...OPTIONS, confirmCreate });

    expect(confirmCreate).toHaveBeenCalledTimes(1);
    expect(calls).toContain("writeFile");
    expect(result).not.toBeNull();
  });

  it("never asks for an entry that already exists", async () => {
    // ‼️ The whole point of §317's wording — 참조와 생성을 분리한다. Prompting
    // on every visit to an existing day would be worse than the defect.
    readFile.mockResolvedValueOnce("# 2026-08-08\n");
    const confirmCreate = vi.fn(async () => true);

    const result = await ensureJournalFile(DATE, { ...OPTIONS, confirmCreate });

    expect(confirmCreate).not.toHaveBeenCalled();
    expect(result?.content).toBe("# 2026-08-08\n");
    expect(calls).not.toContain("writeFile");
  });
});

// An entry that EXISTS but could not be read — invalid UTF-8, a permission refused by the
// OS — used to take the create branch too: this service caught every `readFile` failure as
// "no such file" and wrote today's template over the entry. Silent and irreversible, the
// same defect §277 closed for the PDF companion note, closed the same way: only the
// not-found rejection means "create"; anything else is raised and the disk is left alone.
//
// What fails these: catching every read failure again (writeFile runs, nothing rejects),
// or classifying with anything that does not tell the two `FsError` strings apart. The
// positive half — a real not-found rejection still creates — is the confirmCreate suite
// above, which drives the create branch with `NOT_FOUND`.
describe("ensureJournalFile — an entry it cannot read", () => {
  beforeEach(() => {
    calls.length = 0;
    readFile.mockClear();
    writeFile.mockClear();
    createDir.mockClear();
    logger.error.mockClear();
    useContextStore.setState({
      activeContextId: "ctx-journal",
      contexts: [journalContext()],
    });
    useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  });

  it("raises the read failure and leaves the entry on disk untouched", async () => {
    readFile.mockRejectedValueOnce(UNREADABLE);

    await expect(ensureJournalFile(DATE, OPTIONS)).rejects.toBe(UNREADABLE);

    // Through the mock itself: `mockRejectedValueOnce` replaces the implementation that
    // appends to `calls`, so the read leaves no entry there.
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(calls).not.toContain("createDir");
    expect(calls).not.toContain("writeFile");
    // The rejection names the OS error, not the file — so the log has to.
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(ENTRY),
      UNREADABLE,
    );
  });

  it("does not offer to create an entry that exists", async () => {
    // §317's gate asks "create this date?" — for an entry already on disk that question
    // is the overwrite this suite exists to prevent, with the user's consent attached.
    readFile.mockRejectedValueOnce(UNREADABLE);
    const confirmCreate = vi.fn(async () => true);

    await expect(
      ensureJournalFile(DATE, { ...OPTIONS, confirmCreate }),
    ).rejects.toBe(UNREADABLE);

    expect(confirmCreate).not.toHaveBeenCalled();
    expect(calls).not.toContain("writeFile");
  });
});

// §56f The calendar's weekly note did its own read-or-create inline in `CalendarPanel`,
// with the same catch-everything read — an unreadable weekly note was overwritten by the
// generated outline. It reads through the same classification now, and these pin it the
// same way: both directions, since "never create" would pass the overwrite test alone.
describe("ensurePeriodicNote", () => {
  // The path the calendar actually asks for: `weekly/YYYY/YYYY-Www.md`, so a first
  // weekly note of the year lands in a directory that does not exist yet.
  const WEEK = getWeeklyJournalPath(JOURNAL_DIR, DATE);
  const generate = vi.fn(() => "# 2026-W32\n");

  beforeEach(() => {
    calls.length = 0;
    readFile.mockClear();
    writeFile.mockClear();
    createDir.mockClear();
    generate.mockClear();
    logger.error.mockClear();
  });

  it("creates a note that does not exist, in a directory it creates", async () => {
    readFile.mockRejectedValueOnce(`파일을 찾을 수 없습니다: ${WEEK}`);

    const content = await ensurePeriodicNote(WEEK, DATE, generate);

    expect(content).toBe("# 2026-W32\n");
    expect(createDir).toHaveBeenCalledWith(`${JOURNAL_DIR}/weekly/2026`);
    expect(writeFile).toHaveBeenCalledWith(WEEK, "# 2026-W32\n");
  });

  it("creates it from the template when one is set", async () => {
    readFile
      .mockRejectedValueOnce(`파일을 찾을 수 없습니다: ${WEEK}`)
      .mockResolvedValueOnce("# {{year}} {{week_number}}\n");

    const content = await ensurePeriodicNote(
      WEEK,
      DATE,
      generate,
      "/tpl/weekly.md",
    );

    expect(content).toBe("# 2026 W32\n");
    expect(writeFile).toHaveBeenCalledWith(WEEK, "# 2026 W32\n");
    expect(generate).not.toHaveBeenCalled();
  });

  it("falls back to the generator when the template cannot be read", async () => {
    readFile
      .mockRejectedValueOnce(`파일을 찾을 수 없습니다: ${WEEK}`)
      .mockRejectedValueOnce(UNREADABLE);

    const content = await ensurePeriodicNote(
      WEEK,
      DATE,
      generate,
      "/tpl/weekly.md",
    );

    expect(content).toBe("# 2026-W32\n");
    expect(writeFile).toHaveBeenCalledWith(WEEK, "# 2026-W32\n");
  });

  it("opens a note that exists without writing it", async () => {
    readFile.mockResolvedValueOnce("# my week\n");

    const content = await ensurePeriodicNote(WEEK, DATE, generate);

    expect(content).toBe("# my week\n");
    expect(writeFile).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("raises for a note it cannot read and leaves it untouched", async () => {
    readFile.mockRejectedValueOnce(UNREADABLE);

    await expect(ensurePeriodicNote(WEEK, DATE, generate)).rejects.toBe(
      UNREADABLE,
    );

    expect(writeFile).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(WEEK),
      UNREADABLE,
    );
  });
});
