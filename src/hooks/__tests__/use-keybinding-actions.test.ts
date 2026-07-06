import type { Editor } from "@tiptap/core";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({ logger }));

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
