// issue 594 — a referrer the backend rewrote follows the disk only where that
// costs no unsaved work: a dirty or source-edited tab keeps its document and
// its `openFiles` snapshot; clean surfaces are patched in place (the editor
// that actually holds the tab) or flagged to reload.
import type { EditorView } from "@tiptap/pm/view";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../editor/patch-editor-content", () => ({
  patchEditorContent: vi.fn(() => true),
}));
vi.mock("../../editor/programmatic-update", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../editor/programmatic-update")
  >()),
  loadedTabId: vi.fn(() => "t1"),
}));

import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { patchEditorContent } from "../../editor/patch-editor-content";
import { loadedTabId } from "../../editor/programmatic-update";
import { logger } from "../../logger";
import { syncCleanSurfacesAfterReferrerRewrite } from "../sync-open-surfaces";

const PATH = "/vault/ref.md";
const sharedView = { id: "shared" } as unknown as EditorView;
const pooledView = { id: "pooled" } as unknown as EditorView;
const setFileContent = vi.fn();
const markContentStale = vi.fn();

function tabs(...list: { dirty?: boolean; id: string; path?: string }[]): void {
  useEditorStore.setState({
    activeTabId: "t1",
    tabs: list.map((t) => ({
      filePath: t.path ?? PATH,
      id: t.id,
      isDirty: t.dirty ?? false,
      type: "file",
    })),
  } as never);
}

beforeEach(() => {
  vi.mocked(patchEditorContent).mockClear();
  vi.mocked(loadedTabId).mockReturnValue("t1");
  setFileContent.mockReset();
  markContentStale.mockReset();
  useEditorStore.setState({
    documentSurfaceAccess: {
      editor: { isDestroyed: false, view: sharedView },
      editorStateCache: new Map(),
      isKeepaliveComplete: () => true,
      keepaliveEditor: (tabId: string) =>
        tabId === "t9" ? { isDestroyed: false, view: pooledView } : null,
    },
    markContentStale,
    sourceEditedTabs: [],
    sourceModeTabs: [],
  } as never);
  useFileStore.setState({ setFileContent } as never);
});

describe("syncCleanSurfacesAfterReferrerRewrite", () => {
  it("patches the editor that holds the installed tab and records the text", () => {
    tabs({ id: "t1" });
    expect(syncCleanSurfacesAfterReferrerRewrite(PATH, "new")).toBe(true);
    expect(setFileContent).toHaveBeenCalledWith(PATH, "new");
    expect(patchEditorContent).toHaveBeenCalledWith(sharedView, "new");
    expect(markContentStale).not.toHaveBeenCalled();
  });

  it("patches a keep-alive editor's own view, not the shared one", () => {
    tabs({ id: "t9" });
    vi.mocked(loadedTabId).mockReturnValue("t9");
    syncCleanSurfacesAfterReferrerRewrite(PATH, "new");
    expect(patchEditorContent).toHaveBeenCalledWith(pooledView, "new");
  });

  it("flags a clean background tab to reload instead of touching the shared view", () => {
    tabs({ id: "t2" });
    vi.mocked(loadedTabId).mockReturnValue("t1");
    syncCleanSurfacesAfterReferrerRewrite(PATH, "new");
    expect(patchEditorContent).not.toHaveBeenCalled();
    expect(markContentStale).toHaveBeenCalledWith("t2");
    expect(setFileContent).toHaveBeenCalledWith(PATH, "new");
  });

  it("leaves EVERYTHING alone when a tab of the file holds unsaved work", () => {
    const warns = vi.spyOn(logger, "warn").mockImplementation(() => {});
    tabs({ id: "t1", dirty: true }, { id: "t2" });
    expect(syncCleanSurfacesAfterReferrerRewrite(PATH, "new")).toBe(false);
    expect(setFileContent).not.toHaveBeenCalled();
    expect(patchEditorContent).not.toHaveBeenCalled();
    expect(markContentStale).not.toHaveBeenCalled();
    warns.mockRestore();
  });

  it("treats a source-edited tab as unsaved work too", () => {
    const warns = vi.spyOn(logger, "warn").mockImplementation(() => {});
    tabs({ id: "t1" });
    useEditorStore.setState({ sourceEditedTabs: ["t1"] } as never);
    expect(syncCleanSurfacesAfterReferrerRewrite(PATH, "new")).toBe(false);
    expect(setFileContent).not.toHaveBeenCalled();
    warns.mockRestore();
  });

  it("ignores tabs of other files", () => {
    tabs({ id: "t1", path: "/vault/other.md", dirty: true });
    expect(syncCleanSurfacesAfterReferrerRewrite(PATH, "new")).toBe(true);
    expect(setFileContent).toHaveBeenCalledWith(PATH, "new");
    expect(patchEditorContent).not.toHaveBeenCalled();
  });
});
