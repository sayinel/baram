// §3.6 자동 저장은 마지막 편집 뒤 지연이 지나면 쓴다 — 그 사이 다른 탭으로 옮겨도 그렇다.
//
// 예전에는 타이머 하나가 "예약한 탭이 지금도 활성이면" 만 써서, 편집하고 지연 안에 다른 탭으로 옮기면
// 그 탭은 dirty 로 남고 파일은 옛 내용 그대로였다. 앱이 묶는 대로 실제 훅(`useKeepaliveEditors` ·
// `useSourceMode` · `useAutoSave(activeEditor)` · `useTabSwitching`)을 묶고, IPC 만 가짜로 둔다 —
// 떠난 탭의 문서는 탭 전환이 캐시에 넣고, keep-alive 편집기는 제 문서를 들고 있다가 밀려날 때 그 글을
// `openFiles` 에 남긴다. 그 협력자들을 빼면 저장이 읽을 곳이 없거나 앱과 다른 곳을 읽는다.
import { useRef } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { ProgressiveLoadHandle } from "../../utils/editor/progressive-load";
import type { Editor } from "@tiptap/core";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useUIStore } from "../../stores/ui/ui";
import {
  clearOriginalDoc,
  isTabLoading,
  loadedTabId,
  markContentLoaded,
  setTabLoading,
} from "../../utils/editor/programmatic-update";
import { saveSource } from "../../utils/editor/save-still-current";
import { syncOpenSurfacesAfterDiskWrite } from "../../utils/tasks/sync-open-surfaces";
import { useAutoSave } from "../use-auto-save";
import { triggerAutoReload } from "../use-file-operations";
import { useKeepaliveEditors } from "../use-keepalive-editors";
import { useSourceMode } from "../use-source-mode";
import { useTabSwitching } from "../use-tab-switching";

const NOTE = "/v/note.md";
const COPY = "/v/copy.txt";
const OTHER = "/v/other.md";
const BIG = "/v/big.md";
const NOTE_TEXT = "# NOTE\n\nnote body\n";
const COPY_TEXT = "COPY first\n";
const OTHER_TEXT = "# OTHER\n\nother body\n";

/** The debounce, long enough that a switch made right after a keystroke lands inside it. */
const DELAY = 300;
const DELAY_PASSED = DELAY + 200;

const fileTab = (id: string, filePath: string) => ({
  contextId: "c",
  filePath,
  id,
  isDirty: false,
  isPinned: false,
  title: id,
});

let editor: Editor;
let app: null | ReturnType<typeof mountApp> = null;

/** The hooks `App.tsx` wires for the editing surface, in its order. */
function mountApp() {
  return renderHook(() => {
    const { activeEditor, keepalive, onActiveEditorChange } =
      useKeepaliveEditors(editor);
    const appendHandleRef = useRef<null | {
      handle: ProgressiveLoadHandle;
      tabId: string;
    }>(null);
    const isNavBackForwardRef = useRef(false);
    const scrollOffsets = useRef(new Map<string, number>());
    const source = useSourceMode({
      appendHandleRef,
      editor: activeEditor,
      pool: keepalive,
    });
    useAutoSave(activeEditor);
    useTabSwitching({
      appendHandleRef,
      createKeepaliveEditor: () => makeTestEditor("<p></p>"),
      editor,
      editorStateCache: source.editorStateCache,
      getSourceBuffer: source.getSourceBuffer,
      isNavBackForwardRef,
      keepalive,
      onActiveEditorChange,
      scrollOffsets,
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
      setIsParsing: vi.fn(),
      setSourceBuffer: source.setSourceBuffer,
      sourceModeTabs: source.sourceModeTabs,
    });
    return { activeEditor, keepalive };
  });
}

/** `mountApp`, kept for `afterEach` to unmount once the tabs have closed. */
function mount() {
  app = mountApp();
  return app;
}

const settle = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

const show = (id: string) => {
  act(() => {
    useEditorStore.setState({ activeTabId: id });
  });
};

const installed = (id: string) =>
  waitFor(() => expect(loadedTabId()).toBe(id), { timeout: 5000 });

const loadFinished = (id: string) =>
  waitFor(() => expect(isTabLoading(id)).toBe(false), { timeout: 5000 });

const largeText = (word: string) =>
  Array.from({ length: 520 }, (_, i) => `${word} ${i}`).join("\n\n") + "\n";

function setText(path: string, text: string) {
  disk.set(path, text);
  act(() => useFileStore.getState().setFileContent(path, text));
}

const typeInto = (target: Editor, text: string) => {
  act(() => {
    target.view.dispatch(target.state.tr.insertText(text, 1));
  });
};

const dirty = (id: string) =>
  useEditorStore.getState().tabs.find((t) => t.id === id)?.isDirty;

const writesTo = (path: string) =>
  written.filter(([p]) => p === path).map(([, content]) => content);

/** The unchecked task on `line` of NOTE, as the task index reports it. */
const taskOnLine = (line: number): TaskEntry => ({
  cancelled: null,
  created: null,
  done: null,
  due: null,
  indent: 0,
  line,
  links: [],
  path: NOTE,
  priority: 0,
  raw: "- [ ] task",
  recurrence: null,
  scheduled: null,
  start: null,
  state: "todo",
  tags: [],
  text: "task",
  timer: null,
});

beforeEach(() => {
  disk.clear();
  written.length = 0;
  editor = makeTestEditor("<p></p>");
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: DELAY });
  disk.set(NOTE, NOTE_TEXT);
  disk.set(COPY, COPY_TEXT);
  disk.set(OTHER, OTHER_TEXT);
  disk.set(BIG, largeText("big"));
  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map([
      [BIG, disk.get(BIG)!],
      [COPY, COPY_TEXT],
      [NOTE, NOTE_TEXT],
      [OTHER, OTHER_TEXT],
    ]),
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
    tabs: [
      fileTab("t1", NOTE),
      fileTab("t2", COPY),
      fileTab("t3", OTHER),
      fileTab("t4", BIG),
    ],
  });
  useUIStore.setState({ contentReloadVersion: 0 });
  for (const id of ["t1", "t2", "t3", "t4"]) clearOriginalDoc(id);
});

afterEach(async () => {
  act(() => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });
  });
  // With no tab left, the switch empties the editor on a timer that reads its view.
  await waitFor(() => expect(editor.state.doc.textContent).toBe(""));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  // Unmounting destroys the keep-alive pool (`useKeepaliveEditors`).
  app?.unmount();
  app = null;
  editor.destroy();
});

// Real timers and real loads (two of them 520 blocks), with `waitFor` allowed 5 s inside: the default
// 5 s for the whole test is less than one of its waits, and a loaded machine ran past it.
describe("a tab left during its auto-save debounce", { timeout: 20000 }, () => {
  // What fails this: `saveSource` (save-still-current.ts) answering null for the tab-switch cache, or
  // the save returning once the tab is no longer the active one — what it did before.
  it("is written from the tab-switch cache, and its mark comes down", async () => {
    mount();
    await installed("t1");
    typeInto(editor, "x");
    expect(dirty("t1")).toBe(true);

    show("t3");
    await installed("t3");
    await settle(DELAY_PASSED);

    expect(writesTo(NOTE)).toEqual(["# xNOTE\n\nnote body\n"]);
    expect(dirty("t1")).toBe(false);
    // The tab it went to holds its own document and was not edited.
    expect(writesTo(OTHER)).toEqual([]);
  });

  // What fails this: the same as above. Its own point: no markdown document is installed after the
  // switch, so nothing but the cache holds the tab's document.
  it("is written when the tab it went to is not markdown", async () => {
    mount();
    await installed("t1");
    typeInto(editor, "x");

    show("t2");
    await settle(DELAY_PASSED);

    expect(writesTo(NOTE)).toEqual(["# xNOTE\n\nnote body\n"]);
    expect(dirty("t1")).toBe(false);
  });

  // What fails this: one waiting save for the whole hook — the next tab's edit took the place of
  // this one's, and only the next tab was written.
  it("is written when the next tab is edited before its debounce ends, and so is the next tab", async () => {
    mount();
    await installed("t1");
    typeInto(editor, "x");

    show("t3");
    await installed("t3");
    typeInto(editor, "y");
    await settle(DELAY_PASSED);

    expect(writesTo(NOTE)).toEqual(["# xNOTE\n\nnote body\n"]);
    expect(writesTo(OTHER)).toEqual(["# yOTHER\n\nother body\n"]);
    expect(dirty("t1")).toBe(false);
    expect(dirty("t3")).toBe(false);
  });

  // What fails this: clearing the waiting saves in the cleanup of the effect that listens to the
  // active editor. Leaving a keep-alive tab changes the active editor, which re-runs that effect.
  it("is written from its keep-alive editor when it is a large document", async () => {
    setText(OTHER, largeText("line"));
    useEditorStore.setState({ activeTabId: "t3" });
    const { result } = mount();
    await installed("t3");
    await loadFinished("t3");
    const pooled = result.current.keepalive.get("t3")!;
    await waitFor(() => expect(result.current.activeEditor).toBe(pooled));

    typeInto(pooled, "y");
    expect(dirty("t3")).toBe(true);
    show("t1");
    await installed("t1");
    await settle(DELAY_PASSED);

    const saved = writesTo(OTHER);
    expect(saved).toHaveLength(1);
    expect(saved[0].startsWith("yline 0\n\nline 1\n")).toBe(true);
    expect(dirty("t3")).toBe(false);
    expect(writesTo(NOTE)).toEqual([]);
  });

  // What fails this: `saveSource` (save-still-current.ts) answering null for a tab that holds only
  // its text. The pool keeps one large tab, so opening another evicts this one's editor, and its
  // text is left in `openFiles` (`handleEviction` in use-keepalive-editors.ts) — nothing else holds
  // it. `textSaveOutcome` comparing anything but that text would leave the tab dirty.
  it("is written from its text when another large tab evicted its keep-alive editor", async () => {
    setText(OTHER, largeText("line"));
    useEditorStore.setState({ activeTabId: "t3" });
    const { result } = mount();
    await installed("t3");
    await loadFinished("t3");
    const pooled = result.current.keepalive.get("t3")!;
    await waitFor(() => expect(result.current.activeEditor).toBe(pooled));

    typeInto(pooled, "y");
    show("t4");
    await installed("t4");
    await loadFinished("t4");
    // The precondition this case is about: the editor went before the save came due.
    expect(result.current.keepalive.has("t3")).toBe(false);
    expect(writesTo(OTHER)).toEqual([]);
    await settle(DELAY_PASSED);

    const saved = writesTo(OTHER);
    expect(saved).toHaveLength(1);
    expect(saved[0].startsWith("yline 0\n\nline 1\n")).toBe(true);
    expect(dirty("t3")).toBe(false);
    expect(writesTo(BIG)).toEqual([]);
  });

  // What fails this: writing the cached document of a tab flagged stale — `saveSource` reading past
  // `locateOpenTabSurface`'s "text" answer. "Reload from disk" on a tab with unsaved edits marks a
  // background tab stale, and the text is then the file; the cache would put the discarded edit
  // back over it.
  it("writes the reloaded text, not the discarded edit, once a reload has made its document stale", async () => {
    mount();
    await installed("t1");
    typeInto(editor, "x");
    show("t3");

    const reloaded = "# NOTE\n\nchanged on disk\n";
    disk.set(NOTE, reloaded);
    await act(async () => {
      await triggerAutoReload(NOTE, 999, { force: true });
    });
    expect(useEditorStore.getState().staleContentTabs).toEqual(["t1"]);
    await installed("t3");
    await settle(DELAY_PASSED);

    expect(writesTo(NOTE)).toEqual([reloaded]);
    expect(disk.get(NOTE)).toBe(reloaded);
    expect(dirty("t1")).toBe(false);
  });

  // What fails this: `saveSource` writing a cached document whose `openFiles` text says something
  // else. A task toggled from the task panel in a file whose tab is dirty in the background goes to
  // disk and is spliced into the text only (`syncOpenSurfacesAfterDiskWrite`); the cache still has
  // the line from before. Writing it would take the toggle back off the disk.
  it("is not written over a task toggle that reached the disk and its text but not its cache", async () => {
    const withTask = "# NOTE\n\n- [ ] task\n";
    setText(NOTE, withTask);
    mount();
    await installed("t1");
    typeInto(editor, "x");
    show("t3");
    await installed("t3");

    // The task panel's write of a background tab: the disk, then the surfaces that show the file.
    const toggled = "# NOTE\n\n- [x] task\n";
    disk.set(NOTE, toggled);
    act(() => {
      syncOpenSurfacesAfterDiskWrite(taskOnLine(2), "- [x] task", editor);
    });
    expect(useFileStore.getState().openFiles.get(NOTE)).toBe(
      "# xNOTE\n\n- [x] task\n",
    );
    // The precondition this case is about: the toggle came before the save did.
    expect(writesTo(NOTE)).toEqual([]);
    await settle(DELAY_PASSED);

    expect(writesTo(NOTE)).toEqual([]);
    expect(disk.get(NOTE)).toBe(toggled);
    expect(dirty("t1")).toBe(true);
  });

  // What fails this: dropping the `subscribeContentLoaded` re-arm in `useAutoSave`. A save that comes
  // due while its tab is still loading writes nothing, and nothing else would start it again — the
  // tab stays dirty with the old file until the next keystroke. The load is played by the two calls
  // its end makes (`finishLoad` in load-tab-content.ts).
  it("is written once the load that held it off ends", async () => {
    mount();
    await installed("t1");
    typeInto(editor, "x");
    act(() => setTabLoading("t1", true));
    await settle(DELAY_PASSED);
    expect(writesTo(NOTE)).toEqual([]);

    act(() => {
      setTabLoading("t1", false);
      markContentLoaded("t1");
    });
    await settle(DELAY_PASSED);

    expect(writesTo(NOTE)).toEqual(["# xNOTE\n\nnote body\n"]);
    expect(dirty("t1")).toBe(false);
  });
});

// What fails this: dropping the `isTabLoading` check from `saveSource`. `saveTab` turns a loading tab
// away before it asks, but `textSaveOutcome` asks again once its write has ended: a tab that began
// loading meanwhile answers "text" from `locateOpenTabSurface`, would be judged by that text and
// recorded saved, while what is typed into its first blocks marks nothing dirty (`shouldSkipDirty`).
describe("the save source of a tab still loading", () => {
  it("is nothing, where the same tab not loading answers its text", () => {
    const access = {
      editor,
      editorStateCache: new Map(),
      isKeepaliveComplete: () => true,
      keepaliveEditor: () => null,
    };
    useEditorStore.getState().registerDocumentSurfaceAccess(access);
    try {
      expect(saveSource(editor, "t1", NOTE)).toEqual({
        kind: "text",
        text: NOTE_TEXT,
      });
      setTabLoading("t1", true);
      expect(saveSource(editor, "t1", NOTE)).toBeNull();
    } finally {
      setTabLoading("t1", false);
      useEditorStore.getState().registerDocumentSurfaceAccess(null);
    }
  });
});
