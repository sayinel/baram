// §34 issue 791 — a manual save names the file it saved on the indexVersion bump, so the
// Backlinks panel can tell a save of the note it shows from any other bump. One test per
// save site in `use-file-operations.ts`; harness modeled on
// `use-file-operations-serialize.test.ts`.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => {}),
  writeFile: vi.fn(async () => {}),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
}));

import { save } from "@tauri-apps/plugin-dialog";

import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";
import { useEditorStore } from "../../stores/editor/editor";
import { useLinkStore } from "../../stores/editor/link";
import { useFileStore } from "../../stores/file/file";
import { useFileOperations } from "../use-file-operations";

const TAB = "t1";

/** Run `run` against the real hook and return the path the bump named. */
async function namedBy(
  run: (ops: ReturnType<typeof useFileOperations>) => Promise<void>,
): Promise<null | string> {
  const editor = new Editor({
    content: "<p>body</p>",
    extensions: createBaramExtensions(),
  });
  const ops = renderHook(() =>
    useFileOperations({
      editor,
      getSourceBuffer: () => "",
      sourceModeTabs: new Set(),
    }),
  );
  await act(async () => {
    await run(ops.result.current);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  ops.unmount();
  editor.destroy();
  return useLinkStore.getState().savedPath;
}

function tab(filePath: string): void {
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [],
    sourceModeTabs: [],
    tabs: [
      {
        contextId: "c",
        filePath,
        id: TAB,
        isDirty: true,
        isPinned: false,
        title: "a",
      },
    ],
  });
}

beforeEach(() => {
  vi.mocked(save).mockReset();
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useLinkStore.setState({ indexVersion: 0, savedPath: null });
});

describe("a manual save names its file on the indexVersion bump", () => {
  // 이것을 실패시키는 것: `handleSave` 기존 파일 갈래의 `invalidate(saveTab.filePath)` 에서 인자를 뺀다.
  it("handleSave of an existing file", async () => {
    tab("/v/a.md");
    expect(await namedBy((ops) => ops.handleSave())).toBe("/v/a.md");
  });

  // 이것을 실패시키는 것: `handleSave` Untitled 갈래의 `invalidate(savePath)` 에서 인자를 뺀다.
  it("handleSave of an untitled tab, to the path Save As chose", async () => {
    tab("");
    vi.mocked(save).mockResolvedValue("/v/new.md");
    expect(await namedBy((ops) => ops.handleSave())).toBe("/v/new.md");
  });

  // 이것을 실패시키는 것: `handleSaveAs` 의 `invalidate(savePath)` 에서 인자를 뺀다.
  it("handleSaveAs, to the new path", async () => {
    tab("/v/a.md");
    vi.mocked(save).mockResolvedValue("/v/copy.md");
    expect(await namedBy((ops) => ops.handleSaveAs())).toBe("/v/copy.md");
  });
});
