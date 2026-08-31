// §317 Journal date link rules — a date reaches the journal by CONTEXT, not by
// merely looking like a date.
//
// Before §317, `isDateString(target)` alone opened (and created) a journal
// entry from anywhere, and it ran ahead of the alias, so `[[Journal::…]]` was
// never even consulted. Three defects fell out of that: a silent no-op when the
// journal was off (A), a reference authoring a diary entry (B), and a click
// throwing the reader into a different context (C).
import type { Editor } from "@tiptap/core";

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readSidecar } = vi.hoisted(() => ({ readSidecar: vi.fn() }));
vi.mock("../../components/editor/pdf/pdf-highlight-store", () => ({
  readSidecar,
}));

// ‼️ BOTH exports. use-navigation now imports `findAliasContext` from this
// module too, and a partial mock would leave it undefined — the failure would
// surface as a TypeError inside an async IIFE, i.e. swallowed.
const { findAliasContext, resolveWikilinkTarget } = vi.hoisted(() => ({
  findAliasContext: vi.fn(),
  resolveWikilinkTarget: vi.fn(),
}));
vi.mock("../../utils/editor/wikilink-nav", () => ({
  findAliasContext,
  resolveWikilinkTarget,
}));

const { ensureJournalFile } = vi.hoisted(() => ({
  ensureJournalFile: vi.fn(),
}));
vi.mock("../../services/journal-file-service", () => ({ ensureJournalFile }));

const { showConfirm } = vi.hoisted(() => ({ showConfirm: vi.fn() }));
vi.mock("../../utils/confirm-dialog", () => ({ showConfirm }));

const { createDir, listDir, refreshIndex, writeFile } = vi.hoisted(() => ({
  createDir: vi.fn(async () => {}),
  listDir: vi.fn(async () => []),
  refreshIndex: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));
vi.mock("../../ipc/invoke", () => ({
  createDir,
  listDir,
  refreshIndex,
  writeFile,
}));

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({ logger }));

import type { ContextInfo } from "../../ipc/types";

import { useContextStore } from "../../stores/context/context";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { useNavigation } from "../use-navigation";

const DATE = "2026-08-30";

function ctx(over: Partial<ContextInfo>): ContextInfo {
  return {
    addedAt: 0,
    color: "#000",
    contextType: "vault",
    id: over.path ?? "id",
    label: "L",
    path: "/p",
    ...over,
  } as ContextInfo;
}

const JOURNAL = ctx({
  alias: "일기",
  id: "ctx-journal",
  path: "/v/일기",
  vaultType: "journal",
});
const PLAIN = ctx({
  alias: "work",
  id: "ctx-work",
  path: "/v/work",
  vaultType: "general",
});

function renderNav() {
  const handleOpenFilePath = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useNavigation({ editor: stubEditor(), handleOpenFilePath }),
  );
  return { handleOpenFilePath, result };
}

function stubEditor(): Editor {
  return {
    commands: { scrollIntoView: vi.fn(), setTextSelection: vi.fn() },
    state: { doc: { descendants: vi.fn() } },
    view: { dispatch: vi.fn() },
  } as unknown as Editor;
}

/** Put the workspace in a context, and say whether the journal is configured. */
function setUp(active: ContextInfo, contexts: ContextInfo[] = [active]): void {
  useContextStore.setState({ activeContextId: active.id, contexts });
  useFileStore.setState({ rootPath: active.path });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveWikilinkTarget.mockReturnValue(null);
  findAliasContext.mockReturnValue(null);
  ensureJournalFile.mockResolvedValue({ content: "", path: "/v/일기/x.md" });
  showConfirm.mockResolvedValue(true);
  useSettingsStore.setState({
    journalDirectory: "/v/일기",
    journalEnabled: true,
    journalFilenameFormat: "YYYY-MM-DD",
    journalTemplatePath: undefined,
    journalUseHierarchy: false,
  });
  useUIStore.setState({ toast: null });
});

describe("§317 date link takes the journal route only with journal intent", () => {
  it("opens the journal for a bare date inside the journal context", async () => {
    setUp(JOURNAL);
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleWikilinkNavigate(DATE);

    await waitFor(() => expect(ensureJournalFile).toHaveBeenCalled());
    expect(handleOpenFilePath).toHaveBeenCalledWith("/v/일기/x.md");
  });

  it("opens the journal from ANOTHER vault when the link names it", async () => {
    // The replacement route §317 offers for defect C. It must not depend on the
    // journal being the active context — that is the situation you are in
    // precisely when you want to write [[Journal::2026-08-30]].
    setUp(PLAIN, [PLAIN, JOURNAL]);
    findAliasContext.mockReturnValue(JOURNAL);
    const { handleOpenFilePath, result } = renderNav();

    result.current.handleWikilinkNavigate(DATE, null, "Journal");

    await waitFor(() => expect(ensureJournalFile).toHaveBeenCalled());
    expect(handleOpenFilePath).toHaveBeenCalledWith("/v/일기/x.md");
  });

  it("does NOT open the journal for a bare date in an ordinary vault", async () => {
    // Defect C: this used to jump the reader into the journal space.
    setUp(PLAIN, [PLAIN, JOURNAL]);
    const { result } = renderNav();

    result.current.handleWikilinkNavigate(DATE);

    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    expect(ensureJournalFile).not.toHaveBeenCalled();
  });

  it("does not take the journal route when the alias names a plain vault", async () => {
    setUp(PLAIN, [PLAIN, JOURNAL]);
    findAliasContext.mockReturnValue(PLAIN);
    const { result } = renderNav();

    result.current.handleWikilinkNavigate(DATE, null, "work");

    await waitFor(() => expect(findAliasContext).toHaveBeenCalledWith("work"));
    expect(ensureJournalFile).not.toHaveBeenCalled();
  });
});

describe("§317 defect A — the journal being off is now visible", () => {
  it("shows a toast instead of returning silently", async () => {
    setUp(JOURNAL);
    useSettingsStore.setState({ journalEnabled: false });
    const { result } = renderNav();

    result.current.handleWikilinkNavigate(DATE);

    await waitFor(() =>
      expect(useUIStore.getState().toast?.type).toBe("warning"),
    );
    expect(ensureJournalFile).not.toHaveBeenCalled();
  });
});

describe("§317 defect B — a reference does not author an entry", () => {
  it("hands ensureJournalFile a confirmCreate callback", async () => {
    setUp(JOURNAL);
    const { result } = renderNav();

    result.current.handleWikilinkNavigate(DATE);

    await waitFor(() => expect(ensureJournalFile).toHaveBeenCalled());
    // The service decides WHEN to call it (only when the entry is missing);
    // what this path owes is that the option is supplied at all.
    expect(ensureJournalFile.mock.calls[0][1]).toEqual(
      expect.objectContaining({ confirmCreate: expect.any(Function) }),
    );
  });

  it("routes that callback to a non-destructive confirm", async () => {
    setUp(JOURNAL);
    const { result } = renderNav();

    result.current.handleWikilinkNavigate(DATE);

    await waitFor(() => expect(ensureJournalFile).toHaveBeenCalled());
    await ensureJournalFile.mock.calls[0][1].confirmCreate();
    // `danger` defaults to TRUE in showConfirm — creating a diary entry is not
    // a destructive act and must not be painted as one.
    expect(showConfirm).toHaveBeenCalledWith(
      expect.stringContaining(DATE),
      expect.objectContaining({ danger: false }),
    );
  });
});

describe("§317 a date outside the journal asks before creating a note", () => {
  it("does not write when the user declines", async () => {
    setUp(PLAIN, [PLAIN, JOURNAL]);
    showConfirm.mockResolvedValue(false);
    const { result } = renderNav();

    result.current.handleWikilinkNavigate(DATE);

    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("names the crossing syntax in the question", async () => {
    // The prompt has to teach [[Journal::…]] — otherwise removing the old
    // behaviour just leaves users without a route.
    setUp(PLAIN, [PLAIN, JOURNAL]);
    const { result } = renderNav();

    result.current.handleWikilinkNavigate(DATE);

    await waitFor(() => expect(showConfirm).toHaveBeenCalled());
    expect(showConfirm.mock.calls[0][0]).toContain(`[[Journal::${DATE}]]`);
  });

  it("writes when the user accepts", async () => {
    setUp(PLAIN, [PLAIN, JOURNAL]);
    const { result } = renderNav();

    result.current.handleWikilinkNavigate(DATE);

    await waitFor(() => expect(writeFile).toHaveBeenCalled());
  });

  it("does not ask when there is no journal space to point at", async () => {
    // Nothing to teach, so the ordinary create path stays ordinary.
    setUp(PLAIN, [PLAIN]);
    const { result } = renderNav();

    result.current.handleWikilinkNavigate(DATE);

    await waitFor(() => expect(writeFile).toHaveBeenCalled());
    expect(showConfirm).not.toHaveBeenCalled();
  });

  it("does not ask for a target that is not a date", async () => {
    // Guards the blast radius: ordinary wikilinks still create silently.
    setUp(PLAIN, [PLAIN, JOURNAL]);
    const { result } = renderNav();

    result.current.handleWikilinkNavigate("architecture");

    await waitFor(() => expect(writeFile).toHaveBeenCalled());
    expect(showConfirm).not.toHaveBeenCalled();
  });
});

describe("§316 a mention never takes the journal route", () => {
  // Only page mentions reach this ref at all now: a date mention is a value,
  // and clicking one opens the calendar instead of navigating (mention-view).
  // §317 decided this from `type` here; deciding it at the mention settles it
  // earlier, so this path closes the journal route outright.
  it("opens a file named like a date as itself, even inside the journal", async () => {
    // The case that motivated §317's plumbing: a file genuinely called
    // 2026-08-30.md used to be dragged to the journal whenever the reader
    // happened to be standing in it.
    setUp(JOURNAL);
    resolveWikilinkTarget.mockReturnValue({
      name: `${DATE}.md`,
      path: `/v/일기/${DATE}.md`,
    });
    const { handleOpenFilePath, result } = renderNav();

    result.current.mentionNavigateRef.current("page", DATE);

    await waitFor(() =>
      expect(handleOpenFilePath).toHaveBeenCalledWith(`/v/일기/${DATE}.md`),
    );
    expect(ensureJournalFile).not.toHaveBeenCalled();
  });

  it("does not reach the journal even when told the mention is a date", async () => {
    // Defence in depth: the ref closes the route regardless of what it is
    // handed, so a future caller cannot reopen it by passing "date".
    setUp(JOURNAL);
    const { result } = renderNav();

    result.current.mentionNavigateRef.current("date", DATE);

    // Inside the journal the ordinary create path runs (no "outside" prompt),
    // which is exactly the point: it is treated as a plain wikilink target,
    // not as the day's entry.
    await waitFor(() => expect(writeFile).toHaveBeenCalled());
    expect(ensureJournalFile).not.toHaveBeenCalled();
  });
});
