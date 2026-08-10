// §69 — the plugin detail tab is a rendered control surface, not a document.
//
// "Read-only" is not a property this tab type gets for free: every guard that keeps a
// non-document tab out of the save/source-mode paths asks `isGraphTab`, an ENUMERATED
// check that answers false for any tab type added later. Before the flip to `isFileTab`
// each assertion below failed for a concrete reason, not a theoretical one:
//
//   Cmd+S  → `handleSave` fell through to the `!saveTab.filePath` branch, which opens a
//            Save As dialog and then REWRITES the tab into a file tab (use-file-operations
//            .ts:199-225). The bytes written were whatever the shared editor still held.
//   Cmd+/  → `toggleSourceMode`'s second guard is `isFileTab(tab) && !isMarkdownFile(...)`,
//            which is also false for a plugin tab, so both guards missed and the plugin
//            screen flipped into CodeMirror.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", () => ({
  readFile: vi.fn().mockResolvedValue(""),
  updateFileIndex: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn().mockResolvedValue(null),
}));

import { useRef } from "react";

import { save } from "@tauri-apps/plugin-dialog";

import type { Editor } from "@tiptap/core";

import { writeFile } from "../../ipc/invoke";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileOperations } from "../use-file-operations";
import { useSourceMode } from "../use-source-mode";

/**
 * Stands in for the non-null check only. Every path these tests exercise must return
 * BEFORE touching the editor — `isSourceMode: true` routes the save text to the source
 * ref, so a guard that leaks would reach the dialog without needing a real document.
 * If a future change makes these paths read `editor.state`, this throws rather than
 * quietly passing.
 */
const editorStub = new Proxy({} as Editor, {
  get(_t, prop) {
    if (prop === "isDestroyed") return false;
    throw new Error(`the guard leaked: editor.${String(prop)} was read`);
  },
});

function openPluginTab(): void {
  useEditorStore.setState({ tabs: [], activeTabId: null, mruOrder: [] });
  useEditorStore.getState().openPluginTab("baram-word-count", "Word Count");
}

beforeEach(() => {
  vi.mocked(save).mockClear();
  vi.mocked(writeFile).mockClear();
});

describe("a plugin tab never enters the save path (§69)", () => {
  function harness() {
    return renderHook(() => {
      const sourceContentRef = useRef("stale text from another tab");
      return useFileOperations({
        editor: editorStub,
        isSourceMode: true,
        sourceContentRef,
      });
    });
  }

  it("Cmd+S neither writes a file nor opens a Save As dialog", async () => {
    openPluginTab();
    const { result } = harness();

    await act(async () => {
      await result.current.handleSave();
    });

    expect(save).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("Save As does not turn the plugin tab into a file tab", async () => {
    openPluginTab();
    const before = useEditorStore.getState().tabs[0];
    const { result } = harness();

    await act(async () => {
      await result.current.handleSaveAs();
    });

    expect(save).not.toHaveBeenCalled();
    // The rewrite is the damage that outlives the dialog: filePath and type change and
    // the plugin screen is gone for good.
    const after = useEditorStore.getState().tabs[0];
    expect(after).toEqual(before);
  });

  it("still saves a real file tab — the guard is not a blanket disable", async () => {
    useEditorStore.setState({
      tabs: [
        {
          contextId: "ctx",
          filePath: "/vault/a.md",
          id: "t1",
          isDirty: true,
          isPinned: false,
          title: "a.md",
        },
      ],
      activeTabId: "t1",
      mruOrder: ["t1"],
    });
    const { result } = harness();

    await act(async () => {
      await result.current.handleSave();
    });

    expect(writeFile).toHaveBeenCalledWith(
      "/vault/a.md",
      "stale text from another tab",
    );
  });
});

describe("a plugin tab never enters source mode (§69)", () => {
  it("Cmd+/ leaves source mode off", () => {
    openPluginTab();
    const { result } = renderHook(() => useSourceMode({ editor: editorStub }));

    act(() => {
      result.current.toggleSourceMode();
    });

    expect(result.current.isSourceMode).toBe(false);
  });
});
