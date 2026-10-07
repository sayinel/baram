// §3.2 issue 795 — the Rust watcher drops events below excluded folders except for the
// files open in the editor, so the hook must tell it which those are, every time the
// set changes.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

const setOpenFiles = vi.fn();
vi.mock("../../ipc/invoke", () => ({
  setOpenFiles: (...a: unknown[]) => setOpenFiles(...a),
  watchDir: vi.fn(async () => {}),
}));

import type { EditorTab } from "../../stores/editor/editor";

import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useFileWatcher } from "../use-file-watcher";

function tabs(...paths: string[]): void {
  useEditorStore.setState({
    tabs: paths.map((filePath, i) => ({ filePath, id: `t${i}` }) as EditorTab),
  });
}

beforeEach(() => {
  setOpenFiles.mockReset().mockResolvedValue(undefined);
  useFileStore.setState({ rootPath: "/v" });
  tabs();
});

describe("useFileWatcher registers the open files with the watcher", () => {
  // 이것을 실패시키는 것: use-file-watcher.ts 에서 `setOpenFiles(openFilePaths)` effect 를 지운다.
  it("sends the open set on mount and again whenever it changes", async () => {
    tabs("/v/build/README.md");
    renderHook(() => useFileWatcher());
    await act(async () => {});
    expect(setOpenFiles).toHaveBeenLastCalledWith(["/v/build/README.md"]);

    act(() => tabs("/v/build/README.md", "/v/notes/a.md"));
    await act(async () => {});
    expect(setOpenFiles).toHaveBeenLastCalledWith([
      "/v/build/README.md",
      "/v/notes/a.md",
    ]);

    act(() => tabs());
    await act(async () => {});
    expect(setOpenFiles).toHaveBeenLastCalledWith([]);
    expect(setOpenFiles).toHaveBeenCalledTimes(3);
  });
});
