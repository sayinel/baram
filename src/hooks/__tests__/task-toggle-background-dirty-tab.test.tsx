// §313 저장 안 된 배경 탭의 파일에 태스크 패널이 쓰면, 그 쓰기는 디스크가 아니라 그 탭의 다음 저장이
// 읽는 자리로 간다 — 탭 전환 캐시, keep-alive 편집기, 그 편집기가 밀려났으면 텍스트.
//
// 예전 라우터는 이런 탭을 디스크로 보냈다. 줄은 디스크와 `openFiles` 텍스트에는 들어가도 탭의 문서에는
// 들어가지 않았고, 그 탭의 다음 저장이 문서를 쓰면서 줄을 디스크에서 다시 지웠다 — 돌아와 입력한 뒤의
// 저장에서, §3.6(#1017) 뒤로는 떠난 탭의 자동 저장이 배경에서 쓸 때도. 삭제는 거꾸로 지운 줄을
// 되살렸다. 앱이 묶는 대로 실제 훅을 묶고(`auto-save-tab-left-during-debounce` 와 같은 하네스), 태스크
// 패널의 입구(`writeTaskState` · `applyTaskDelete`)를 부른다. 가짜는 IPC(Rust 의 미리보기와 줄 쓰기는
// `[ ]` 를 `[x]` 로 바꾸거나 줄을 지우고, 디스크 쓰기는 낙관적 잠금 — 줄 번호 + 원문 — 을 건다), 이벤트
// 구독, 그리고 앱이 탭 전환 훅에 넘기는 콜백들(빈 함수, keep-alive 편집기는 `makeTestEditor`)이다.
import { useRef } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { ProgressiveLoadHandle } from "../../utils/editor/progressive-load";
import type { TaskTriageContext } from "../../utils/tasks/task-triage";
import type { Editor } from "@tiptap/core";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, string>();
const written: [string, string][] = [];
/** The file of each line the Rust side wrote or deleted on disk — the task panel's disk route. */
const lineWrites: string[] = [];
/** Holds the Rust preview of a line, so a test can act while a write waits for it. */
const preview = { gate: Promise.resolve() };

/** `replace_line` / `delete_line` in src-tauri/src/task/write.rs: the line must still be what the index saw. */
function onDisk(
  path: string,
  line: number,
  expectedRaw: string,
  raw: null | string,
) {
  const lines = (disk.get(path) ?? "").split("\n");
  if (lines[line] !== expectedRaw) return Promise.reject("stale");
  if (raw === null) lines.splice(line, 1);
  else lines[line] = raw;
  disk.set(path, lines.join("\n"));
  lineWrites.push(path);
  return Promise.resolve(raw ?? undefined);
}

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => undefined),
}));
vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  deleteTaskLine: (path: string, line: number, expectedRaw: string) =>
    onDisk(path, line, expectedRaw, null),
  getFileTasks: () => Promise.resolve([]),
  previewTaskStateLine: async (raw: string) => {
    await preview.gate;
    return raw.replace("- [ ]", "- [x]");
  },
  readFile: (path: string) => Promise.resolve(disk.get(path) ?? ""),
  setTaskState: (path: string, line: number, expectedRaw: string) =>
    onDisk(path, line, expectedRaw, expectedRaw.replace("- [ ]", "- [x]")),
  updateFileIndex: () => Promise.resolve(),
  watchDir: () => Promise.resolve(),
  writeFile: (path: string, content: string) => {
    written.push([path, content]);
    disk.set(path, content);
    return Promise.resolve();
  },
}));

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { t } from "../../i18n";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import { useTaskStore } from "../../stores/tasks/task-store";
import { useUIStore } from "../../stores/ui/ui";
import {
  clearOriginalDoc,
  isTabLoading,
  loadedTabId,
} from "../../utils/editor/programmatic-update";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { applyTaskDelete } from "../../utils/tasks/apply-task-delete";
import { writeTaskState } from "../../utils/tasks/task-triage";
import { useAutoSave } from "../use-auto-save";
import { useKeepaliveEditors } from "../use-keepalive-editors";
import { useSourceMode } from "../use-source-mode";
import { useTabSwitching } from "../use-tab-switching";

const NOTE = "/v/note.md";
const OTHER = "/v/other.md";
const BIG = "/v/big.md";
const BIG2 = "/v/big2.md";
const NOTE_TEXT = "# NOTE\n\n- [ ] task\n";
const OTHER_TEXT = "# OTHER\n\nother body\n";
const largeText = (word: string) =>
  Array.from({ length: 520 }, (_, i) => `${word} ${i}`).join("\n\n") + "\n";
/** 521 top-level blocks — over the keep-alive threshold — with the task last, on line 1040. */
const BIG_TEXT = largeText("line") + "\n- [ ] task\n";

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

function mount() {
  app = mountApp();
  return app;
}

/** The hooks `App.tsx` wires for the editing surface, in its order. */
function mountApp() {
  return renderHook(() => {
    const { activeEditor, keepalive, onActiveEditorChange } =
      useKeepaliveEditors(editor);
    useAutoSave(activeEditor);
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

const typeInto = (target: Editor, text: string) => {
  act(() => {
    target.view.dispatch(target.state.tr.insertText(text, 1));
  });
};

/** A new paragraph right after the heading: every line below it moves down two. */
const addLineAboveTheTask = (target: Editor) => {
  act(() => {
    const { schema } = target.state;
    const afterHeading = target.state.doc.firstChild!.nodeSize;
    target.view.dispatch(
      target.state.tr.insert(
        afterHeading,
        schema.nodes.paragraph.create(null, schema.text("added")),
      ),
    );
  });
};

const dirty = (id: string) =>
  useEditorStore.getState().tabs.find((t) => t.id === id)?.isDirty;

const writesTo = (path: string) =>
  written.filter(([p]) => p === path).map(([, content]) => content);

/** The unchecked task on `line` of `path`, as the task index reports it. */
const taskAt = (path: string, line: number): TaskEntry => ({
  cancelled: null,
  created: null,
  done: null,
  due: null,
  indent: 0,
  line,
  links: [],
  path,
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

/** The task panel's checkbox, from `writeTaskState` (task-triage.ts) on: the write and its accounting. */
const checkUnwrapped = (task: TaskEntry, activeEditor: Editor | null) => {
  useTaskStore.getState().setAll([task]);
  const ctx: TaskTriageContext = {
    editor: activeEditor,
    exclude: [],
    now: new Date(2026, 10, 26),
    recordDoneDate: false,
    t: (key, params) => t(key, "en", params),
    trackTime: false,
  };
  return writeTaskState(task, "done", ctx);
};

const check = (task: TaskEntry, activeEditor: Editor | null) =>
  act(() => checkUnwrapped(task, activeEditor));

const storeState = () => useTaskStore.getState().tasks[0]?.state;

beforeEach(() => {
  disk.clear();
  written.length = 0;
  lineWrites.length = 0;
  preview.gate = Promise.resolve();
  editor = makeTestEditor("<p></p>");
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: DELAY });
  disk.set(NOTE, NOTE_TEXT);
  disk.set(OTHER, OTHER_TEXT);
  disk.set(BIG, BIG_TEXT);
  disk.set(BIG2, largeText("big"));
  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map([
      [BIG, BIG_TEXT],
      [BIG2, disk.get(BIG2)!],
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
      fileTab("t3", OTHER),
      fileTab("t4", BIG),
      fileTab("t5", BIG2),
    ],
  });
  useTaskStore.getState().clear();
  useUIStore.setState({ contentReloadVersion: 0 });
  useUIStore.getState().dismissToast();
  for (const id of ["t1", "t3", "t4", "t5"]) clearOriginalDoc(id);
});

afterEach(async () => {
  act(() => {
    useEditorStore.setState({ activeTabId: null, tabs: [] });
  });
  await waitFor(() => expect(editor.state.doc.textContent).toBe(""));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  app?.unmount();
  app = null;
  editor.destroy();
});

describe(
  "a task written into a background tab with unsaved edits",
  { timeout: 20000 },
  () => {
    // What fails this: the router sending the tab to the disk (`resolveTaskWriteTarget`). The toggle
    // then reached the disk and the text but not the cached document, and the save already due wrote
    // the document — the toggle was on disk for that long.
    it("goes into the tab's cached document, and the tab's save writes it with the edit", async () => {
      const { result } = mount();
      await installed("t1");
      typeInto(editor, "x");
      show("t3");
      await installed("t3");

      await check(taskAt(NOTE, 2), result.current.activeEditor);
      expect(lineWrites).toEqual([]);
      expect(disk.get(NOTE)).toBe(NOTE_TEXT);
      expect(storeState()).toBe("done");
      await settle(DELAY_PASSED);

      expect(writesTo(NOTE)).toEqual(["# xNOTE\n\n- [x] task\n"]);
      expect(dirty("t1")).toBe(false);
    });

    // Before §3.6 as well: the document installed on the way back had no toggle, and the next save
    // wrote it.
    it("is in the document when the user goes back to the tab, and stays on disk after typing", async () => {
      const { result } = mount();
      await installed("t1");
      typeInto(editor, "x");
      show("t3");
      await installed("t3");
      await check(taskAt(NOTE, 2), result.current.activeEditor);

      show("t1");
      await installed("t1");
      expect(serializeLiveDoc(editor)).toBe("# xNOTE\n\n- [x] task\n");
      typeInto(editor, "z");
      await settle(DELAY_PASSED);

      expect(disk.get(NOTE)).toBe("# zxNOTE\n\n- [x] task\n");
    });

    // What fails this: putting the line where the tab's text was read before its preview came back
    // (`writeToUnsavedTab`). The tab came back meanwhile and its cached state is installed in the shared
    // editor; a change put into the cache entry never reaches the document the tab holds now.
    it("lands where the tab is once the preview of the line comes back", async () => {
      const { result } = mount();
      await installed("t1");
      typeInto(editor, "x");
      show("t3");
      await installed("t3");
      let release!: () => void;
      preview.gate = new Promise((resolve) => {
        release = resolve;
      });

      const pending = checkUnwrapped(
        taskAt(NOTE, 2),
        result.current.activeEditor,
      );
      show("t1");
      await installed("t1");
      release();
      await act(() => pending);

      expect(serializeLiveDoc(editor)).toBe("# xNOTE\n\n- [x] task\n");
      await settle(DELAY_PASSED);
      expect(disk.get(NOTE)).toBe("# xNOTE\n\n- [x] task\n");
    });

    // What fails this: landing what was spliced from a text read before another write to the same
    // tab landed. Both writes wait for their previews together; each must splice into the text the
    // other left, or the second takes the first's line back while the store says it is done.
    it("keeps both of two writes to the same tab that wait for their previews together", async () => {
      const twoTasks = "# NOTE\n\n- [ ] task\n- [ ] task\n";
      disk.set(NOTE, twoTasks);
      act(() => useFileStore.getState().setFileContent(NOTE, twoTasks));
      const { result } = mount();
      await installed("t1");
      typeInto(editor, "x");
      show("t3");
      await installed("t3");

      await act(() =>
        Promise.all([
          checkUnwrapped(taskAt(NOTE, 2), result.current.activeEditor),
          checkUnwrapped(taskAt(NOTE, 3), result.current.activeEditor),
        ]),
      );

      expect(useFileStore.getState().openFiles.get(NOTE)).toBe(
        "# xNOTE\n\n- [x] task\n- [x] task\n",
      );
      await settle(DELAY_PASSED);
      expect(disk.get(NOTE)).toBe("# xNOTE\n\n- [x] task\n- [x] task\n");
    });

    // The tab is active again but its cached state is not installed yet — the restore waits on a
    // timer and reads the cache when it fires (`restoreCachedState`). The write lands in that cache.
    it("lands in the cache a scheduled restore is about to install", async () => {
      const { result } = mount();
      await installed("t1");
      typeInto(editor, "x");
      show("t3");
      await installed("t3");

      show("t1");
      expect(loadedTabId()).not.toBe("t1");
      await check(taskAt(NOTE, 2), result.current.activeEditor);
      expect(lineWrites).toEqual([]);
      await installed("t1");

      expect(serializeLiveDoc(editor)).toBe("# xNOTE\n\n- [x] task\n");
    });

    // What fails this: landing in `openFiles` alone. A keep-alive tab writes nothing there when it is
    // left (`saveOutgoingTab`), its editor is what its save reads, and that editor is not touched.
    it("goes into the keep-alive editor of a large document", async () => {
      useEditorStore.setState({ activeTabId: "t4" });
      const { result } = mount();
      await installed("t4");
      await loadFinished("t4");
      const pooled = result.current.keepalive.get("t4")!;
      await waitFor(() => expect(result.current.activeEditor).toBe(pooled));
      typeInto(pooled, "y");
      show("t1");
      await installed("t1");

      await check(taskAt(BIG, 1040), result.current.activeEditor);
      expect(lineWrites).toEqual([]);
      expect(serializeLiveDoc(pooled).endsWith("\n- [x] task\n")).toBe(true);
      await settle(DELAY_PASSED);

      const saved = writesTo(BIG);
      expect(saved).toHaveLength(1);
      expect(saved[0].startsWith("yline 0\n")).toBe(true);
      expect(saved[0].endsWith("\n- [x] task\n")).toBe(true);
    });

    // The text case: another large tab evicted this tab's keep-alive editor, so its text in `openFiles`
    // is all there is, and what its save writes (`saveSource`).
    it("goes into the text of a large document whose keep-alive editor was evicted", async () => {
      useEditorStore.setState({ activeTabId: "t4" });
      const { result } = mount();
      await installed("t4");
      await loadFinished("t4");
      const pooled = result.current.keepalive.get("t4")!;
      await waitFor(() => expect(result.current.activeEditor).toBe(pooled));
      typeInto(pooled, "y");
      show("t5");
      await installed("t5");
      await loadFinished("t5");
      expect(result.current.keepalive.has("t4")).toBe(false);

      await check(taskAt(BIG, 1040), result.current.activeEditor);
      expect(lineWrites).toEqual([]);
      await settle(DELAY_PASSED);

      const saved = writesTo(BIG);
      expect(saved).toHaveLength(1);
      expect(saved[0].startsWith("yline 0\n")).toBe(true);
      expect(saved[0].endsWith("\n- [x] task\n")).toBe(true);
    });

    // The panel's line number is the disk's; the tab's edit put the task two lines further down. The
    // write is refused and the user is told, as for the active tab with unsaved edits — the toggle is
    // written nowhere, and the store keeps the task as it was.
    it("is refused and reported when the tab's edit moved the task's line", async () => {
      const { result } = mount();
      await installed("t1");
      addLineAboveTheTask(editor);
      show("t3");
      await installed("t3");

      await check(taskAt(NOTE, 2), result.current.activeEditor);

      expect(lineWrites).toEqual([]);
      expect(useUIStore.getState().toast?.message).toBe(
        t("tasks.unsavedConflict", "en"),
      );
      expect(storeState()).toBe("todo");
      await settle(DELAY_PASSED);
      expect(writesTo(NOTE)).toEqual(["# NOTE\n\nadded\n\n- [ ] task\n"]);
    });

    // What fails this: deleting on disk. The tab's save wrote its document back over the deletion.
    it("deletes the line from the tab's document, and the tab's save writes the deletion", async () => {
      const { result } = mount();
      await installed("t1");
      typeInto(editor, "x");
      show("t3");
      await installed("t3");

      let deleted: unknown;
      await act(async () => {
        deleted = await applyTaskDelete(
          taskAt(NOTE, 2),
          result.current.activeEditor,
        );
      });
      expect(deleted).toEqual({ kind: "document" });
      expect(lineWrites).toEqual([]);
      await settle(DELAY_PASSED);

      expect(writesTo(NOTE)).toEqual(["# xNOTE\n"]);
    });

    // The control: a clean background tab still goes to the disk, and its document follows the file
    // when it comes back (`syncOpenSurfacesAfterDiskWrite` flags it stale).
    it("goes to the disk when the tab has nothing unsaved", async () => {
      const { result } = mount();
      await installed("t1");
      show("t3");
      await installed("t3");

      await check(taskAt(NOTE, 2), result.current.activeEditor);
      expect(lineWrites).toEqual([NOTE]);
      expect(disk.get(NOTE)).toBe("# NOTE\n\n- [x] task\n");

      show("t1");
      await installed("t1");
      expect(serializeLiveDoc(editor)).toBe("# NOTE\n\n- [x] task\n");
    });
  },
);
