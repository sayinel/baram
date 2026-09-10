import type { Editor } from "@tiptap/core";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({ logger }));

const { ensureJournalFile } = vi.hoisted(() => ({
  ensureJournalFile: vi.fn(async () => null),
}));
vi.mock("../../services/journal-file-service", () => ({
  ensureJournalDirRegistered: vi.fn(async () => {}),
  ensureJournalFile,
  openFileInTab: vi.fn(async () => {}),
}));

vi.mock("../use-close-guard", () => ({
  requestReload: vi.fn(),
}));

import { t } from "../../i18n";
import { getAction } from "../../keybindings/keybinding-actions";
import { TASK_INPUT_COMMAND } from "../../keybindings/keybinding-registry";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { requestReload } from "../use-close-guard";
import { useKeybindingActions } from "../use-keybinding-actions";

/** Minimal Editor stub satisfying getSelectionMarkdown()'s usage. */
function makeEditorStub(selectionText: string): Editor {
  return {
    state: {
      selection: { from: 0, to: selectionText.length || 1 },
      doc: { textBetween: () => selectionText },
    },
    // §12-9b: registerEditorMutationTask keys a WeakMap by editor.view
    view: {},
  } as unknown as Editor;
}

function renderActionsHook(editor: Editor | null) {
  return renderHook(() =>
    useKeybindingActions({
      editor,
      handleCloseFolder: vi.fn(),
      handleCloseTab: vi.fn(),
      handleNewFile: vi.fn(),
      handleOpenFile: vi.fn().mockResolvedValue(undefined),
      handleOpenFolder: vi.fn().mockResolvedValue(undefined),
      handleSave: vi.fn().mockResolvedValue(undefined),
      handleSaveAs: vi.fn().mockResolvedValue(undefined),
      inlineAI: { activate: vi.fn() },
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
      setSidebarPanel: vi.fn(),
      toggleCommandPalette: vi.fn(),
      toggleQuickSwitcher: vi.fn(),
      toggleSettings: vi.fn(),
      toggleSidebar: vi.fn(),
      toggleSourceMode: vi.fn(),
    }),
  );
}

describe("view.reload — registry action wiring (§479)", () => {
  it("registers view.reload and dispatches to requestReload", () => {
    vi.mocked(requestReload).mockClear();
    renderActionsHook(null);

    getAction("view.reload")?.();

    expect(requestReload).toHaveBeenCalledOnce();
  });
});

describe("zettelkasten.newFromSelection — gated to the zettel space (§95/§99 M5)", () => {
  beforeEach(() => {
    logger.warn.mockClear();
    useUIStore.getState().closeZettelTitleDialog();
    useSettingsStore.getState().setZettelkastenEnabled(true);
    useSettingsStore.getState().setZettelkastenDirectory("/vault/zettel");
    useFileStore.getState().setRootPath("/vault");
  });

  it("no-ops (does not open the title dialog) when the active file is outside the zettel dir", () => {
    useEditorStore.setState({
      tabs: [
        {
          id: "t1",
          contextId: "c1",
          filePath: "/vault/notes/other.md",
          isDirty: false,
          isPinned: false,
          title: "other",
        },
      ],
      activeTabId: "t1",
    });
    const editor = makeEditorStub("some selected text");
    renderActionsHook(editor);

    act(() => getAction("zettelkasten.newFromSelection")?.());

    expect(useUIStore.getState().zettelTitleDialog.open).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("not in the zettel space"),
    );
  });

  it("opens the title dialog when the active file is inside the zettel dir", () => {
    useEditorStore.setState({
      tabs: [
        {
          id: "t2",
          contextId: "c1",
          filePath: "/vault/zettel/notes/202607051530 x.md",
          isDirty: false,
          isPinned: false,
          title: "x",
        },
      ],
      activeTabId: "t2",
    });
    const editor = makeEditorStub("some selected text");
    renderActionsHook(editor);

    act(() => getAction("zettelkasten.newFromSelection")?.());

    expect(useUIStore.getState().zettelTitleDialog.open).toBe(true);
  });

  it("no-ops when there is no active tab at all", () => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    const editor = makeEditorStub("some selected text");
    renderActionsHook(editor);

    act(() => getAction("zettelkasten.newFromSelection")?.());

    expect(useUIStore.getState().zettelTitleDialog.open).toBe(false);
  });
});

// §85 — the shortcut must say why nothing opened.
//
// `journal.openToday` returned silently when Journal was off or its directory did not
// resolve: no toast, no log. A keyboard shortcut that does nothing at all is
// indistinguishable from a shortcut that is not bound, so the user has no way to learn
// that a setting is missing. The journal preset now toasts for the same two cases
// (workspace.ts) — this is the shortcut half of that contract.
describe("journal.openToday — unconfigured feedback", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      journalDirectory: "/tmp/baram-journal-test",
      journalEnabled: true,
      locale: "en",
    });
    useUIStore.setState({ toast: null });
  });

  it("toasts when the journal is disabled", () => {
    useSettingsStore.setState({ journalEnabled: false });
    renderActionsHook(null);

    act(() => getAction("journal.openToday")?.());

    // Compared against the catalogue's TEXT, not `t(...)` on both sides: `t` falls back
    // to the key, so a `t`-vs-`t` assertion stays green while the toast ships the raw
    // key "space.journal.disabled" to the user.
    const message = useUIStore.getState().toast?.message;
    expect(message).toBe(t("space.journal.disabled", "en"));
    expect(message).toContain("Enable Journal");
  });

  it("toasts when the journal directory does not resolve", () => {
    // resolveJournalDir takes absolute paths only, so a relative value resolves to
    // nothing — the same dead end as an empty setting, and it used to be silent too.
    useSettingsStore.setState({ journalDirectory: "journal" });
    renderActionsHook(null);

    act(() => getAction("journal.openToday")?.());

    const message = useUIStore.getState().toast?.message;
    expect(message).toBe(t("space.journal.noDirectory", "en"));
    expect(message).toContain("Set the Journal directory");
  });

  it("toasts a localized message when the open fails, not the raw error", async () => {
    // Tauri commands reject with a bare string (CLAUDE.md: `Result<T, String>`), so
    // `String(err)` puts an untranslated absolute path on screen — in a surface the
    // user may be screen-sharing, and in the ko locale from a function that localizes
    // its two other branches. The project keeps the raw text in the logger and toasts a
    // key (see stores/file/file.ts access-denied handling).
    ensureJournalFile.mockRejectedValueOnce(
      new Error("Access denied: /Volumes/private/journal/2026-08-08.md"),
    );
    renderActionsHook(null);

    await act(async () => {
      getAction("journal.openToday")?.();
      await Promise.resolve();
    });

    const message = useUIStore.getState().toast?.message;
    expect(message).toBe(t("space.journal.openFailed", "en"));
    expect(message).toContain("Could not open");
    expect(message).not.toContain("/Volumes/private");
    expect(logger.error).toHaveBeenCalled();
  });
});

// §338/I-6 — `journal.memories` used to open the right panel unconditionally,
// giving a disabled Journal a reachable, non-vacuous state (C-2). It now goes
// through `featureReady("journal")`, which is the "render" half of the
// completeness pair described in use-keybinding-actions-feature-gate.test.ts
// (that file's scan proves the call MENTIONS featureReady; this proves it
// actually blocks the action AND tells the user why — and the positive
// control proves the gate does not also block the enabled case).
describe("journal.memories — feature-gated (§338/I-6)", () => {
  beforeEach(() => {
    useUIStore.setState({
      rightPanelOpen: false,
      rightPanelMode: "chat",
      toast: null,
    });
    useSettingsStore.setState({ journalEnabled: true, locale: "en" });
  });

  it("does not open the panel and toasts when journal is disabled", () => {
    useSettingsStore.setState({ journalEnabled: false });
    renderActionsHook(null);

    act(() => getAction("journal.memories")?.());

    const ui = useUIStore.getState();
    expect(ui.rightPanelOpen).toBe(false);
    expect(ui.rightPanelMode).toBe("chat");
    expect(ui.toast?.message).toBe(t("space.journal.disabled", "en"));
  });

  it("opens the memories panel and does not toast when journal is enabled", () => {
    renderActionsHook(null);

    act(() => getAction("journal.memories")?.());

    const ui = useUIStore.getState();
    expect(ui.rightPanelOpen).toBe(true);
    expect(ui.rightPanelMode).toBe("memories");
    expect(ui.toast).toBeNull();
  });
});

// §338/I-6 — the 4 zettelkasten.* actions already checked `zettelkastenEnabled`
// before this fix, but silently (`logger.warn`, no toast) — itself forbidden
// by §18.19 결함 A, the same rule §85 already applied to journal.openToday.
// `zettelkasten.newNote` is the simplest of the 4 to drive as a real behavior
// test; the other 3 share the same `featureReady("zettelkasten")` call
// (proven by the source scan) and their own pre-existing directory/tab checks
// (proven by the zettelkasten.newFromSelection suite above).
describe("zettelkasten.newNote — feature-gated (§338/I-6)", () => {
  beforeEach(() => {
    useUIStore.getState().closeZettelTitleDialog();
    useUIStore.setState({ toast: null });
    useSettingsStore.setState({
      zettelkastenEnabled: true,
      zettelkastenDirectory: "/vault/zettel",
      locale: "en",
    });
    useFileStore.getState().setRootPath("/vault");
  });

  it("does not open the title dialog and toasts when zettelkasten is disabled", () => {
    useSettingsStore.setState({ zettelkastenEnabled: false });
    renderActionsHook(null);

    act(() => getAction("zettelkasten.newNote")?.());

    expect(useUIStore.getState().zettelTitleDialog.open).toBe(false);
    expect(useUIStore.getState().toast?.message).toBe(
      t("space.zettel.disabled", "en"),
    );
  });

  it("opens the title dialog and does not toast when zettelkasten is enabled", () => {
    renderActionsHook(null);

    act(() => getAction("zettelkasten.newNote")?.());

    expect(useUIStore.getState().zettelTitleDialog.open).toBe(true);
    expect(useUIStore.getState().toast).toBeNull();
  });
});

describe("tasks.taskInput — 한 명령의 두 갈래", () => {
  beforeEach(() => {
    useUIStore.setState({ quickCaptureOpen: false, taskEditOpen: false });
  });

  it("캡처창이 닫혀 있으면 편집 모달을 연다", () => {
    renderActionsHook(null);
    act(() => getAction(TASK_INPUT_COMMAND)?.());
    expect(useUIStore.getState().taskEditOpen).toBe(true);
  });

  it("캡처창이 열려 있으면 모달을 열지 않는다", () => {
    // ‼️ 캡처창의 핸들러는 `preventDefault`만 하고 전파를 막지 않아, 이 액션은 같은
    // 키 하나에 **함께** 불린다. 이 갈래가 없으면 태스크 모드가 켜지는 동시에 모달이
    // 뜨고, 거기서 저장한 태스크는 캡처와 무관한 현재 문서에 생긴다.
    useUIStore.setState({ quickCaptureOpen: true });
    renderActionsHook(null);
    act(() => getAction(TASK_INPUT_COMMAND)?.());
    expect(useUIStore.getState().taskEditOpen).toBe(false);
  });

  // §338/Fix H follow-up — the dual dispatch above (dialog's own handler +
  // this global action, both reached from one keypress) is NOT two layers
  // giving opposite answers: `quickCaptureOpen` is checked BEFORE
  // `featureReady("tasks")` in the handler above, so this branch returns
  // before ever reaching the toast. Confirmed empirically (not assumed) —
  // if the two checks are ever reordered, this pins the toast staying silent
  // while the dialog is open regardless of tasksEnabled.
  it("캡처창이 열려 있으면 tasks가 꺼져 있어도 토스트를 띄우지 않는다", () => {
    useUIStore.setState({ quickCaptureOpen: true, toast: null });
    useSettingsStore.setState({ tasksEnabled: false });
    renderActionsHook(null);
    act(() => getAction(TASK_INPUT_COMMAND)?.());
    expect(useUIStore.getState().taskEditOpen).toBe(false);
    expect(useUIStore.getState().toast).toBeNull();
  });
});

// §338 — team-lead's ruling: gate tasks.taskInput now that `space.tasks.disabled`
// exists, rather than leave it a named exception. Behavior, not presence: the
// dialog must not open AND the toast must show — a scan proving the call site
// "mentions featureReady" (use-keybinding-actions-feature-gate.test.ts) cannot
// tell a correct gate from a broken one.
describe("tasks.taskInput — feature-gated (§338, team-lead ruling on Fix D)", () => {
  beforeEach(() => {
    useUIStore.setState({
      quickCaptureOpen: false,
      taskEditOpen: false,
      toast: null,
    });
    useSettingsStore.setState({ tasksEnabled: true, locale: "en" });
  });

  // ‼️ Split into two `it`s on purpose, not combined into one with two
  // `expect`s: a failing `expect` throws and aborts the rest of the `it`, so
  // a single combined test cannot tell "the block broke" from "the toast
  // broke" — one mutation killing the first assertion would hide whether the
  // second still held. Verified by mutation testing (see fix-d-report.md):
  // removing only the `return` (keeping the `featureReady("tasks")` call)
  // fails just "blocks", not "toasts" — the two are NOT the same fact.
  // Removing the whole guard line kills both, which is expected: with no
  // call to `featureReady` at all, neither the block nor its toast has
  // anywhere left to come from.
  it("blocks the dialog when tasks is disabled", () => {
    useSettingsStore.setState({ tasksEnabled: false });
    renderActionsHook(null);

    act(() => getAction(TASK_INPUT_COMMAND)?.());

    expect(useUIStore.getState().taskEditOpen).toBe(false);
  });

  it("toasts why when tasks is disabled", () => {
    useSettingsStore.setState({ tasksEnabled: false });
    renderActionsHook(null);

    act(() => getAction(TASK_INPUT_COMMAND)?.());

    expect(useUIStore.getState().toast?.message).toBe(
      t("space.tasks.disabled", "en"),
    );
  });

  it("opens the dialog and does not toast when tasks is enabled — positive control", () => {
    renderActionsHook(null);

    act(() => getAction(TASK_INPUT_COMMAND)?.());

    expect(useUIStore.getState().taskEditOpen).toBe(true);
    expect(useUIStore.getState().toast).toBeNull();
  });
});
