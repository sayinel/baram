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

import { t } from "../../i18n";
import { getAction } from "../../keybindings/keybinding-actions";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import { useKeybindingActions } from "../use-keybinding-actions";

/** Minimal Editor stub satisfying getSelectionMarkdown()'s usage. */
function makeEditorStub(selectionText: string): Editor {
  return {
    state: {
      selection: { from: 0, to: selectionText.length || 1 },
      doc: { textBetween: () => selectionText },
    },
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

    expect(useUIStore.getState().toast?.message).toBe(
      t("space.journal.disabled", "en"),
    );
  });

  it("toasts when the journal directory does not resolve", () => {
    // resolveJournalDir takes absolute paths only, so a relative value resolves to
    // nothing — the same dead end as an empty setting, and it used to be silent too.
    useSettingsStore.setState({ journalDirectory: "journal" });
    renderActionsHook(null);

    act(() => getAction("journal.openToday")?.());

    expect(useUIStore.getState().toast?.message).toBe(
      t("space.journal.noDirectory", "en"),
    );
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
    expect(message).not.toContain("/Volumes/private");
    expect(logger.error).toHaveBeenCalled();
  });
});
