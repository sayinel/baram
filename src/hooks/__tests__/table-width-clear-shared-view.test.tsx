// §5.5 A non-markdown tab installs nothing in the shared editor, so `loadedTabId` goes
// on naming the last markdown tab, and an external reload then replaces the shared
// document without touching that name. Turning the column resize option off must not
// read that document as the named tab's. Real hooks, fake IPC, no timing involved.
import { useRef } from "react";

import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const disk = new Map<string, string>();
const written: [string, string][] = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => Promise.resolve(disk.get(path) ?? ""),
  updateFileIndex: () => Promise.resolve(),
  watchDir: () => Promise.resolve(),
  writeFile: (path: string, content: string) => {
    written.push([path, content]);
    disk.set(path, content);
    return Promise.resolve();
  },
}));

import type { ProgressiveLoadHandle } from "../../utils/editor/progressive-load";

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import {
  clearOriginalDoc,
  loadedTabId,
} from "../../utils/editor/programmatic-update";
import { setTableColumnResizeFromUser } from "../../utils/editor/table-width-clear";
import { useAutoSave } from "../use-auto-save";
import { useEditorEffects } from "../use-editor-effects";
import { triggerAutoReload } from "../use-file-operations";
import { createKeepalivePool } from "../use-large-doc-keepalive";
import { useSourceMode } from "../use-source-mode";
import { useTabSwitching } from "../use-tab-switching";

const NOTE = "/v/note.md";
const COPY = "/v/copy.txt";
const NOTE_TEXT =
  "<!-- colwidths:200,300 -->\n\n| NOTE | B |\n| - | - |\n| 1 | 2 |\n";

const fileTab = (id: string, filePath: string) => ({
  contextId: "c",
  filePath,
  id,
  isDirty: false,
  isPinned: false,
  title: id,
});

function hasWidths(state: EditorState): boolean {
  let found = false;
  state.doc.descendants((node) => {
    if (node.attrs.userResized || node.attrs.colwidth) found = true;
    return true;
  });
  return found;
}

let editor: Editor;

function mountApp() {
  return renderHook(() => {
    const appendHandleRef = useRef<null | {
      handle: ProgressiveLoadHandle;
      tabId: string;
    }>(null);
    const isNavBackForwardRef = useRef(false);
    const pool = useRef(createKeepalivePool());
    const scrollOffsets = useRef(new Map<string, number>());
    const source = useSourceMode({
      appendHandleRef,
      editor,
      pool: pool.current,
    });
    useAutoSave(editor);
    useTabSwitching({
      appendHandleRef,
      createKeepaliveEditor: () => makeTestEditor("<p></p>"),
      editor,
      editorStateCache: source.editorStateCache,
      getSourceBuffer: source.getSourceBuffer,
      isNavBackForwardRef,
      keepalive: pool.current,
      onActiveEditorChange: vi.fn(),
      scrollOffsets,
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
      setIsParsing: vi.fn(),
      setSourceBuffer: source.setSourceBuffer,
      sourceModeTabs: source.sourceModeTabs,
    });
    useEditorEffects({
      editor,
      editorStateCache: source.editorStateCache,
      inlineAI: { applyContent: vi.fn(), previewInsertAfterSelection: vi.fn() },
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
    });
    return source;
  });
}

beforeEach(() => {
  disk.clear();
  written.length = 0;
  editor = makeTestEditor("<p></p>");
  useSettingsStore.setState({ autoSave: false, tableColumnResize: true });
  disk.set(NOTE, NOTE_TEXT);
  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map([[NOTE, NOTE_TEXT]]),
    rootPath: "/v",
  });
  useEditorStore.setState({
    activeTabId: "t1",
    contentRefreshKey: 0,
    mruOrder: ["t1"],
    sourceBufferAccess: null,
    sourceEditedTabs: [],
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [fileTab("t1", NOTE), fileTab("t2", COPY)],
  });
  clearOriginalDoc("t1");
  clearOriginalDoc("t2");
});

afterEach(async () => {
  act(() => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });
  });
  // With no tab left, the switch empties the editor on a timer that reads its view,
  // and the load's scroll reset waits for a frame that reads it too.
  await waitFor(() => expect(editor.state.doc.textContent).toBe(""));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  editor.destroy();
});

it.each([
  [
    "with a width comment",
    "<!-- colwidths:7,8 -->\n\n| COPY | B |\n| - | - |\n| 1 | 2 |\n",
  ],
  ["with none", "| COPY | B |\n| - | - |\n| 1 | 2 |\n"],
])(
  "a reloaded non-markdown tab %s: the named tab is cleared in its own document",
  async (_name, copyText) => {
    disk.set(COPY, copyText);
    useFileStore.getState().setFileContent(COPY, copyText);
    const source = mountApp();
    await waitFor(() => expect(loadedTabId()).toBe("t1"));

    act(() => {
      useEditorStore.setState({ activeTabId: "t2" });
    });
    await act(async () => {
      await triggerAutoReload(COPY, 999);
    });
    // The state itself: t1 is named while the shared editor holds the other document.
    expect(loadedTabId()).toBe("t1");
    expect(editor.state.doc.textContent).toContain("COPY");
    const held = editor.state;

    setTableColumnResizeFromUser(false);

    expect(editor.state).toBe(held);
    const cached = source.result.current.editorStateCache.current.get("t1")!;
    expect(cached.doc.textContent).toContain("NOTE");
    expect(cached.doc.textContent).not.toContain("COPY");
    expect(hasWidths(cached)).toBe(false);
    const text = useFileStore.getState().openFiles.get(NOTE)!;
    expect(text).toContain("NOTE");
    expect(text).not.toContain("COPY");
    expect(text).not.toContain("colwidths");
    expect(
      useEditorStore.getState().tabs.find((tab) => tab.id === "t1")?.isDirty,
    ).toBe(true);
    expect(written).toHaveLength(0);
  },
);

it("the active markdown tab: the clear reaches its file through the auto-save", async () => {
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: 50 });
  mountApp();
  await waitFor(() => expect(loadedTabId()).toBe("t1"));
  const isDirty = () =>
    useEditorStore.getState().tabs.find((tab) => tab.id === "t1")?.isDirty;
  // Without widths in the document the clear would have nothing to do.
  expect(hasWidths(editor.state)).toBe(true);
  expect(editor.state.doc.textContent).toContain("NOTE");
  expect(written).toHaveLength(0);

  act(() => {
    setTableColumnResizeFromUser(false);
  });

  expect(isDirty()).toBe(true);
  await waitFor(() => expect(written).toHaveLength(1));
  await waitFor(() => expect(isDirty()).toBe(false));
  const [path, text] = written[0]!;
  expect(path).toBe(NOTE);
  expect(text).toContain("NOTE");
  expect(text).not.toContain("colwidths");
  expect(hasWidths(editor.state)).toBe(false);
  expect(written.every(([target]) => target === NOTE)).toBe(true);
});
