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
import { ensureJournalFile, openFileInTab } from "../journal-file-service";

describe("openFileInTab", () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
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
// contexts the store already persisted). FIVE of the six `ensureJournalFile` call sites
// skipped it — the shortcut (`use-keybinding-actions.ts:411`), Alt+←/→ day navigation
// (`:188`), the calendar (`CalendarPanel.tsx:202`), date-wikilink navigation
// (`use-navigation.ts:73`) and the startup hook (`use-journal.ts:51`); only the journal
// space (`spaces/journal-space.ts:33`) registered. So on first use from any of them,
// `readFile` was denied, this service read that as "file does not exist", `createDir`
// was denied too, and every caller's catch swallowed it: a silent no-op that healed
// itself only once the user had entered the journal space at least once.
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
    readFile.mockRejectedValueOnce(new Error("Access denied (mock)"));

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
