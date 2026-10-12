// §392 · §3.2 A plugin viewer's refresh key moves when an outside change is reloaded.
//
// EditorArea hands PluginViewerHost `previewFileMtime` as its `refreshKey`, and that is the
// file's `lastSaveMtime` (`use-active-tab-surface.ts`). A reload that applies records the
// change's mtime there, so the viewer is told to refresh; one that does not apply (a dirty tab,
// issue 795) leaves it.
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: vi.fn(async () => "changed outside"),
}));

import type { EditorTab } from "../../stores/editor/editor";

import { usePluginUIStore } from "../../plugins/plugin-ui-store";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useActiveTabSurface } from "../use-active-tab-surface";
import { triggerAutoReload } from "../use-file-operations";

const PATH = "/v/pad.strokes";

function show(dirty: boolean) {
  useEditorStore.setState({
    activeTabId: "t1",
    previewSourceTabs: [],
    sourceEditedTabs: [],
    sourceModeTabs: [],
    tabs: [
      { filePath: PATH, id: "t1", isDirty: dirty, title: "pad" } as EditorTab,
    ],
  } as never);
}

beforeEach(() => {
  usePluginUIStore.setState({
    fileViewers: [
      {
        extensions: ["strokes"],
        onMount: () => undefined,
        pluginId: "sketch",
        viewerId: "sketch:pad",
      },
    ],
  });
  useFileStore.setState({
    fileMtimes: new Map([[PATH, { canReloadMtime: 0, lastSaveMtime: 10 }]]),
    openFiles: new Map([[PATH, "before"]]),
  });
});

// 이것을 실패시키는 것: triggerAutoReload 에서 적용한 뒤의 `updateLastSaveMtime(filePath, externalMtime)` 를
// 지우면 viewer 의 refresh key 가 그대로다.
describe("§392 a plugin viewer's refresh key and an outside change", () => {
  it("moves to the change's mtime when the reload applies", async () => {
    show(false);
    const { result } = renderHook(() => useActiveTabSurface());
    expect(result.current.isPluginPreviewTab).toBe(true);
    expect(result.current.previewFileMtime).toBe(10);

    await act(async () => {
      await triggerAutoReload(PATH, 5000);
    });

    expect(result.current.previewFileMtime).toBe(5000);
  });

  it("stays when the reload does not apply to a dirty tab", async () => {
    // 긍정 짝 — 적용하지 않는 리로드는 키를 옮기지 않는다(issue 795).
    show(true);
    const { result } = renderHook(() => useActiveTabSurface());
    await act(async () => {
      await triggerAutoReload(PATH, 5000);
    });
    expect(result.current.previewFileMtime).toBe(10);
  });
});
