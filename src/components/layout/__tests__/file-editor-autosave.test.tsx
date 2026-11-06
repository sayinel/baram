// §89 A file window's document is never installed through the tab switch, so the window says so
// itself, or `use-auto-save` reads its tab as not installed and never writes.
import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.hoisted(() =>
  vi.fn(async (_path: string, _content: string) => undefined),
);

vi.mock("../../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../ipc/invoke")>()),
  readFile: vi.fn(async () => "on disk\n"),
  updateFileIndex: vi.fn(async () => undefined),
  watchDir: vi.fn(async () => undefined),
  writeFile,
}));

import type { Editor } from "@tiptap/core";

import { useContextStore } from "../../../stores/context/context";
import { useEditorStore } from "../../../stores/editor/editor";
import { useSettingsStore } from "../../../stores/settings/store";
import { FileEditorLayout } from "../FileEditorLayout";

beforeEach(() => {
  writeFile.mockClear();
  useEditorStore.setState({ activeTabId: null, mruOrder: [], tabs: [] });
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 30 });
  useContextStore.setState({
    contexts: [],
    ensureFileContext: vi.fn(async () => undefined),
  } as never);
});

describe("a file window", () => {
  it("auto-saves what is typed in it", async () => {
    render(<FileEditorLayout filePath="/v/note.md" />);
    await waitFor(() =>
      expect(document.querySelector(".tiptap")?.textContent).toContain(
        "on disk",
      ),
    );
    await waitFor(() => expect(useEditorStore.getState().tabs).toHaveLength(1));

    act(() => {
      (
        document.querySelector(".tiptap") as unknown as { editor: Editor }
      ).editor.commands.insertContent("typed ");
    });

    await waitFor(() => expect(writeFile).toHaveBeenCalledOnce());
    expect(writeFile.mock.calls[0][1]).toContain("typed");
  });
});
