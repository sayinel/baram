// §5.5 `loadedTabId` names the tab whose document the shared editor holds. A cold
// load replaces that document with its first chunk well before `finishLoad` names
// the new tab, and a switch can cancel the load so that `finishLoad` never runs.
import type { EditorTab } from "../../../stores/editor/editor";
import type { TabSwitchContext } from "../types";
import type { Editor } from "@tiptap/core";

import { Schema } from "@tiptap/pm/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../extensions/plugins/vim/replace-editor-state", () => ({
  replaceEditorStateWithVim: vi.fn(),
}));
vi.mock("../after-doc-load", () => ({ afterDocLoad: vi.fn() }));
vi.mock("../../../pipeline/parse-async", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../pipeline/parse-async")>()),
  parseMdastAsync: vi.fn(async () => ({})),
}));
vi.mock("../../../pipeline/md-to-pm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../pipeline/md-to-pm")>()),
  mdastBlocksToPmNodes: vi.fn(),
}));
vi.mock("../../../utils/editor/progressive-load", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../utils/editor/progressive-load")
  >()),
  appendChunksProgressively: vi.fn(),
}));

import { replaceEditorStateWithVim } from "../../../extensions/plugins/vim/replace-editor-state";
import { mdastBlocksToPmNodes } from "../../../pipeline/md-to-pm";
import { useEditorStore } from "../../../stores/editor/editor";
import {
  isTabLoading,
  loadedTabId,
  markContentLoaded,
  setTabLoading,
} from "../../../utils/editor/programmatic-update";
import {
  appendChunksProgressively,
  FIRST_CHUNK_BLOCKS,
} from "../../../utils/editor/progressive-load";
import { LARGE_DOC_BLOCK_THRESHOLD } from "../../use-large-doc-keepalive";
import { loadTabContent } from "../load-tab-content";
import { installContent } from "../types";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { content: "text*", group: "block" },
    text: {},
  },
});

/** Untitled, so the install announces no file and restores no folds. */
const TAB = { filePath: "", id: "t2", type: "file" } as EditorTab;

function context(shared: Editor, pooled: Editor = makeEditor()) {
  return {
    appendHandleRef: { current: null },
    createKeepaliveEditor: () => pooled,
    editor: shared,
    installContent,
    keepalive: {
      acquire: vi.fn(),
      has: () => false,
      markComplete: vi.fn(),
    },
    onActiveEditorChange: vi.fn(),
    progressiveLoadRef: { current: { cancelled: false } },
    setIsParsing: vi.fn(),
  } as unknown as TabSwitchContext;
}

function documentOf(blockCount: number): void {
  vi.mocked(mdastBlocksToPmNodes).mockReturnValue(
    Array.from({ length: blockCount }, () => schema.node("paragraph")),
  );
}

function makeEditor(): Editor {
  return {
    schema,
    state: { plugins: [] },
    view: { dom: document.createElement("div") },
  } as unknown as Editor;
}

/** The worker has answered: the load has flagged the tab and deferred its first chunk. */
async function parsed(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  expect(isTabLoading("t2")).toBe(true);
}

let finishLoad: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(replaceEditorStateWithVim).mockClear();
  vi.mocked(appendChunksProgressively).mockImplementation(
    (_editor, _chunks, opts) => {
      finishLoad = opts.onComplete;
      return { cancel: vi.fn() };
    },
  );
  useEditorStore.setState({ activeTabId: "t2" });
  setTabLoading("t2", false);
  markContentLoaded("t1");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadedTabId through a cold load", () => {
  it("into the shared editor: names no tab from the first chunk until finishLoad names the new one", async () => {
    const shared = makeEditor();
    documentOf(FIRST_CHUNK_BLOCKS + 1);

    loadTabContent(context(shared), "t2", TAB, "");
    await parsed();
    // Flagged, but the document has not been replaced: the view does hold t1.
    expect(loadedTabId()).toBe("t1");

    vi.runOnlyPendingTimers();

    expect(replaceEditorStateWithVim).toHaveBeenCalledTimes(1);
    expect(vi.mocked(replaceEditorStateWithVim).mock.calls[0]![0]).toBe(
      shared.view,
    );
    expect(loadedTabId()).toBeNull();

    finishLoad();

    expect(isTabLoading("t2")).toBe(false);
    expect(loadedTabId()).toBe("t2");
  });

  it("into a keep-alive editor: goes on naming the outgoing tab, whose document the shared editor still holds", async () => {
    const shared = makeEditor();
    const pooled = makeEditor();
    documentOf(LARGE_DOC_BLOCK_THRESHOLD);

    loadTabContent(context(shared, pooled), "t2", TAB, "");
    await parsed();
    vi.runOnlyPendingTimers();

    expect(vi.mocked(replaceEditorStateWithVim).mock.calls[0]![0]).toBe(
      pooled.view,
    );
    expect(loadedTabId()).toBe("t1");

    finishLoad();

    expect(loadedTabId()).toBe("t2");
  });

  it("cancelled before its first chunk: goes on naming the outgoing tab, because the document was never replaced", async () => {
    const ctx = context(makeEditor());
    documentOf(FIRST_CHUNK_BLOCKS + 1);

    loadTabContent(ctx, "t2", TAB, "");
    await parsed();
    ctx.progressiveLoadRef.current.cancelled = true;
    vi.runOnlyPendingTimers();

    expect(replaceEditorStateWithVim).not.toHaveBeenCalled();
    expect(isTabLoading("t2")).toBe(false);
    expect(loadedTabId()).toBe("t1");
  });
});
