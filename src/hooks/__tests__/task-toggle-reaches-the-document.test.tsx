/*
 * §313 사이드바에서 태스크를 체크하면 **열린 문서가 바뀐다**.
 *
 * 결함의 형태가 둘이었다.
 *
 * 1. 활성 clean WYSIWYG 탭. 라우터가 디스크로 보내고(`!tab.isDirty`), 쓰기 뒤 회계는
 *    태스크 스토어만 새로 고친다 — 아무도 에디터에게 무엇도 부탁하지 않는다. 문서가
 *    바뀌는 유일한 통로가 OS 워처를 한 바퀴 도는 것이었고, 그렇게 돌아온 변경은
 *    **남의 편집**으로 도착했다: "Reloaded external changes" 토스트, 그리고 실행 취소
 *    스택과 선택을 함께 버리는 전체 재구축.
 *
 * 2. 배경 clean 탭. 자동 리로드가 `lastSaveMtime`을, 워처가 `canReloadMtime`을 같은
 *    값으로 세워 탭 전환의 낡음 판정이 거짓이 되고, 돌아오면 **캐시된 EditorState**가
 *    복원된다 — 토글 이전의 텍스트다. 다음 저장이 그것을 파일에 되쓴다. 조용한 손실.
 *
 * 그래서 여기서 보는 것은 배선이 아니라 사용자에게 남는 것이다: 화면의 마크다운,
 * 디스크의 바이트, 토스트가 떴는지, 되돌리기가 아직 되는지, 탭이 dirty로 더럽혀졌는지.
 */
import { useRef } from "react";

import type { TaskEntry } from "../../ipc/types";
import type { EditorTab } from "../../stores/editor/editor";
import type { Editor } from "@tiptap/core";

import { renderHook, waitFor } from "@testing-library/react";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 가짜 디스크. 값과 mtime을 함께 들고 있다 — 워처 이벤트가 mtime을 싣는다. */
const disk = new Map<string, { content: string; mtime: number }>();
let clock = 1_000;

const writeToDisk = (path: string, content: string) => {
  clock += 10;
  disk.set(path, { content, mtime: clock });
};

/** `file:changed` 핸들러 — `useFileWatcher`가 등록한 진짜 핸들러를 여기 담아 둔다. */
type ChangedHandler = (e: {
  payload: { mtime: number; origin?: string; path: string };
}) => void;
let onFileChanged: ChangedHandler | null = null;

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, handler: unknown) => {
    if (name === "file:changed") onFileChanged = handler as ChangedHandler;
    return Promise.resolve(() => undefined);
  },
}));

vi.mock("../../ipc/invoke", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ipc/invoke")>();
  return {
    ...actual,
    getFileTasks: () => Promise.resolve([]),
    readFile: (path: string) => Promise.resolve(disk.get(path)?.content ?? ""),
    /** Rust `set_task_state`의 자리 — 낙관적 잠금까지 같은 규칙으로 흉내 낸다. */
    setTaskState: (
      path: string,
      line: number,
      expectedRaw: string,
      _state: string,
      recordDoneDate: boolean,
      today: string,
    ) => {
      const entry = disk.get(path);
      if (!entry) return Promise.reject("stale");
      const lines = entry.content.split("\n");
      if ((lines[line] ?? "").trimEnd() !== expectedRaw.trimEnd()) {
        return Promise.reject("stale");
      }
      const updated =
        lines[line].replace("- [ ]", "- [x]") +
        (recordDoneDate ? ` ✅${today}` : "");
      lines[line] = updated;
      writeToDisk(path, lines.join("\n"));
      return Promise.resolve(updated);
    },
    updateFileIndex: () => Promise.resolve(),
    watchDir: () => Promise.resolve(),
  };
});

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { markdownToProsemirror, prosemirrorToMarkdown } from "../../pipeline";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useTaskStore } from "../../stores/tasks/task-store";
import { useUIStore } from "../../stores/ui/ui";
import { clearOriginalDoc } from "../../utils/editor/programmatic-update";
import { toggleTaskState } from "../../utils/tasks/task-triage";
import { useEditorEffects } from "../use-editor-effects";
import { useFileWatcher } from "../use-file-watcher";
import { createKeepalivePool } from "../use-large-doc-keepalive";
import { useTabSwitching } from "../use-tab-switching";

const NOTE = "/v/note.md";
const OTHER = "/v/other.md";

const MD = [
  "# 오늘",
  "",
  "- [ ] 원고 마감",
  "- [ ] 장보기",
  "",
  "마지막 문단.",
  "",
].join("\n");

/** `- [ ] 원고 마감`은 0-based 2행. */
const TASK: TaskEntry = {
  cancelled: null,
  created: null,
  done: null,
  due: null,
  indent: 0,
  line: 2,
  links: [],
  path: NOTE,
  priority: 0,
  raw: "- [ ] 원고 마감",
  recurrence: null,
  scheduled: null,
  start: null,
  state: "todo",
  tags: [],
  text: "원고 마감",
};

const CTX = {
  editor: null as Editor | null,
  exclude: [] as string[],
  now: new Date("2026-08-26T09:00:00Z"),
  rootPath: "/v",
  t: ((k: string) => k) as never,
};

const tab = (id: string, filePath: string, isDirty = false): EditorTab => ({
  contextId: "c",
  filePath,
  id,
  isDirty,
  isPinned: false,
  title: id,
});

let editor: Editor;
const editorStateCache = new Map<string, EditorState>();

/** 워처가 실제로 올려 보내는 이벤트 한 건. */
async function deliverFileChanged(path: string, origin: "app" | "external") {
  await waitFor(() => expect(onFileChanged).not.toBeNull());
  onFileChanged!({
    payload: { mtime: disk.get(path)!.mtime, origin, path },
  });
}

function docMarkdown(): string {
  return prosemirrorToMarkdown(editor.state.doc);
}

function install(md: string) {
  editor.view.updateState(
    EditorState.create({
      doc: markdownToProsemirror(md, editor.schema),
      plugins: editor.state.plugins,
    }),
  );
}

function isDirty(tabId: string): boolean {
  return useEditorStore.getState().tabs.find((t) => t.id === tabId)!.isDirty;
}

/** 워처가 등록돼 있고, `useEditorEffects`가 활성 탭을 지켜보는 상태로 만든다. */
function mountApp() {
  const result = renderHook(() => {
    const cacheRef = useRef(editorStateCache);
    useFileWatcher();
    useEditorEffects({
      editor,
      editorStateCache: cacheRef,
      inlineAI: { applyContent: vi.fn() },
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
    });
    return null;
  });
  return result;
}

function toastMessage(): null | string {
  return useUIStore.getState().toast?.message ?? null;
}

beforeEach(() => {
  disk.clear();
  clock = 1_000;
  onFileChanged = null;
  editorStateCache.clear();
  editor = makeTestEditor("<p></p>");

  writeToDisk(NOTE, MD);
  writeToDisk(OTHER, "# 다른 파일\n");
  install(MD);

  useUIStore.getState().dismissToast();
  useTaskStore.setState({ bufferRelativePaths: [] });
  useFileStore.setState({
    fileMtimes: new Map([
      [NOTE, { canReloadMtime: 0, lastSaveMtime: disk.get(NOTE)!.mtime }],
    ]),
    openFiles: new Map([
      [NOTE, MD],
      [OTHER, "# 다른 파일\n"],
    ]),
    rootPath: "/v",
  });
  useEditorStore.setState({
    activeTabId: "t1",
    contentRefreshKey: 0,
    mruOrder: ["t1"],
    sourceBufferAccess: null,
    sourceModeTabs: [],
    tabs: [tab("t1", NOTE), tab("t2", OTHER)],
  });
  clearOriginalDoc("t1");
  clearOriginalDoc("t2");
  CTX.editor = editor;
});

afterEach(() => {
  editor.destroy();
});

describe("체크박스를 누르면 — 활성 clean WYSIWYG 탭", () => {
  it("워처를 기다리지 않고 화면의 문서가 바뀐다", async () => {
    mountApp();

    await toggleTaskState(TASK, true, CTX);

    // 사용자가 보고 있는 것.
    expect(docMarkdown()).toContain("- [x] 원고 마감 ✅2026-08-26");
    // 그리고 파일.
    expect(disk.get(NOTE)!.content).toContain("- [x] 원고 마감 ✅2026-08-26");
  });

  it("남의 편집인 척하지 않는다 — 토스트가 없다", async () => {
    mountApp();

    await toggleTaskState(TASK, true, CTX);
    await deliverFileChanged(NOTE, "app");
    await waitFor(() => expect(docMarkdown()).toContain("- [x]"));

    expect(toastMessage()).toBeNull();
  });

  it("사용자가 쌓아 둔 실행 취소를 버리지 않는다", async () => {
    mountApp();
    // 사용자가 한 편집 하나 — 그리고 자동 저장이 그것을 파일로 만들어 탭이 clean이 됐다.
    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      "<p>사용자가 친 문단</p>",
    );
    const saved = docMarkdown();
    writeToDisk(NOTE, saved);
    useFileStore.getState().setFileContent(NOTE, saved);
    useEditorStore.getState().markDirty("t1", false);

    await toggleTaskState(TASK, true, CTX);
    await deliverFileChanged(NOTE, "app");
    await waitFor(() => expect(docMarkdown()).toContain("- [x]"));

    expect(editor.commands.undo()).toBe(true);
    const afterUndo = docMarkdown();
    expect(afterUndo).not.toContain("사용자가 친 문단");
    expect(afterUndo).toContain("- [x] 원고 마감 ✅2026-08-26");
  });

  it("이미 저장된 변경을 저장되지 않은 것처럼 보이게 하지 않는다", async () => {
    mountApp();

    await toggleTaskState(TASK, true, CTX);
    await deliverFileChanged(NOTE, "app");
    await waitFor(() => expect(docMarkdown()).toContain("- [x]"));

    // 디스크가 이미 그렇게 말하고 있다 — dirty 점이 뜨면 거짓말이고, 자동 저장이
    // 같은 바이트를 다시 쓴다.
    expect(isDirty("t1")).toBe(false);
  });

  it("openFiles 캐시도 함께 맞는다 — 저장 경로가 읽는 것이 그것이다", async () => {
    mountApp();

    await toggleTaskState(TASK, true, CTX);

    expect(useFileStore.getState().openFiles.get(NOTE)).toContain(
      "- [x] 원고 마감 ✅2026-08-26",
    );
  });
});

describe("진짜 외부 편집은 그대로 리로드된다", () => {
  it("다른 프로그램이 파일을 바꾸면 화면에 반영하고 알린다", async () => {
    mountApp();

    writeToDisk(NOTE, "# 오늘\n\n다른 프로그램이 통째로 바꿔 놓았다.\n");
    await deliverFileChanged(NOTE, "external");

    await waitFor(() =>
      expect(docMarkdown()).toContain("다른 프로그램이 통째로 바꿔 놓았다."),
    );
    expect(toastMessage()).toContain("Reloaded external changes");
  });
});

describe("체크박스를 누르면 — 배경 clean 탭", () => {
  /** 배경 탭 t1의 상태를 캐시에 넣고 t2를 활성으로 만든다 — 탭을 떠날 때 일어나는 일. */
  function leaveNoteTabBehind() {
    editorStateCache.set("t1", editor.state);
    install("# 다른 파일\n");
    useEditorStore.setState({ activeTabId: "t2", mruOrder: ["t2", "t1"] });
  }

  function switchBackHarness() {
    return renderHook(() => {
      const appendHandleRef = useRef(null);
      const cacheRef = useRef(editorStateCache);
      const isNavBackForwardRef = useRef(false);
      useTabSwitching({
        appendHandleRef,
        createKeepaliveEditor: () => editor,
        editor,
        editorStateCache: cacheRef,
        getSourceBuffer: () => "",
        isNavBackForwardRef,
        keepalive: createKeepalivePool(),
        onActiveEditorChange: vi.fn(),
        scrollOffsets: { current: new Map<string, number>() },
        setFindReplaceMode: vi.fn(),
        setFindReplaceOpen: vi.fn(),
        setIsParsing: vi.fn(),
        setSourceBuffer: vi.fn(),
        sourceModeTabs: new Set<string>(),
      });
      return null;
    });
  }

  it("돌아왔을 때 캐시된 옛 텍스트가 토글을 되돌리지 않는다", async () => {
    mountApp();
    leaveNoteTabBehind();

    await toggleTaskState(TASK, true, CTX);
    await deliverFileChanged(NOTE, "app");

    // 사용자가 그 탭으로 돌아온다.
    const { rerender } = switchBackHarness();
    useEditorStore.setState({ activeTabId: "t1", mruOrder: ["t1", "t2"] });
    rerender();

    await waitFor(() =>
      expect(docMarkdown()).toContain("- [x] 원고 마감 ✅2026-08-26"),
    );
    // 그리고 이 문서가 곧 다음 저장이 쓸 바이트다.
    expect(docMarkdown()).not.toContain("- [ ] 원고 마감");
  });
});
