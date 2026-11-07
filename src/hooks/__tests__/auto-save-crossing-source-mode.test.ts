// §3.6 소스 모드의 탭은 버퍼가 글의 주인이고 `use-code-auto-save` 가 쓴다. 그런데 WYSIWYG 에서 입력해 건
// `use-auto-save` 의 타이머는 소스 모드로 넘어가도 살아 있고, 돌면 소스 모드 전 문서를 파일에 쓰고 표시를
// 내린다. 소스 쪽 타이머가 더 나중에 걸리므로 보통은 곧 버퍼로 다시 쓰이지만, 그 사이 디스크는 옛 글인데
// 탭은 깨끗하다. 그 틈에 탭을 닫거나 앱을 끄면 묻지 않고 소스에서 친 글을 잃는다.
//
// 앱의 배선 그대로 실제 훅 넷을 묶어 돌린다. 두 타이머가 어떻게 겹치는지가 이 결함의 전부이고, 소스 쪽
// 타이머를 빼고 돌리면 옛 글이 영영 남는 것처럼 보여 결함을 잘못 읽게 된다.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeFile = vi.hoisted(() =>
  vi.fn(async (_path: string, _content: string) => undefined),
);

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: vi.fn(async () => undefined),
  writeFile,
}));

import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";
import { isTabUnsaved, useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import {
  getOriginalDoc,
  markContentLoaded,
} from "../../utils/editor/programmatic-update";
import { useAutoSave } from "../use-auto-save";
import { useCodeAutoSave } from "../use-code-auto-save";
import { useFileOperations } from "../use-file-operations";
import { useSourceMode } from "../use-source-mode";

const DELAY = 2000;
const PATH = "/v/note.md";
const TAB = "t1";

let editor: Editor;

function advance(ms: number) {
  return act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Wired the way `App.tsx` wires them. */
type Mounted = ReturnType<typeof mount>;

function mount() {
  return renderHook(() => {
    const source = useSourceMode({ editor });
    useCodeAutoSave({
      bufferVersion: source.bufferVersion,
      getSourceBuffer: source.getSourceBuffer,
      isEditableTextFile: false,
      markDirty: useEditorStore.getState().markDirty,
      sourceModeTabs: source.sourceModeTabs,
    });
    useAutoSave(editor);
    const { handleSave } = useFileOperations({
      editor,
      getSourceBuffer: source.getSourceBuffer,
      sourceModeTabs: source.sourceModeTabs,
    });
    return { ...source, handleSave };
  });
}

function toggle(hook: Mounted) {
  act(() => {
    hook.result.current.toggleSourceMode();
  });
}

function typeInDocument() {
  act(() => {
    editor.commands.insertContent("typed ");
  });
}

/** What the source editor's `onChange` does in `tab-surface-renderers.tsx`. */
function typeInSource(hook: Mounted, text: string) {
  act(() => {
    hook.result.current.setSourceBuffer(TAB, text);
    useEditorStore.getState().markSourceEdited(TAB, true);
  });
}

function unsaved(): boolean {
  const { sourceEditedTabs, tabs } = useEditorStore.getState();
  return isTabUnsaved(tabs[0], sourceEditedTabs);
}

function written(): string[] {
  return writeFile.mock.calls.map(([, content]) => content);
}

beforeEach(() => {
  vi.useFakeTimers();
  writeFile.mockClear();
  useSettingsStore.setState({ autoSave: true, autoSaveDelay: DELAY });
  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map([[PATH, "on disk\n"]]),
  });
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [],
    sourceEditedTabs: [],
    sourceModeTabs: [],
    tabs: [
      {
        contextId: "c",
        filePath: PATH,
        id: TAB,
        isDirty: false,
        isPinned: false,
        title: "note.md",
      },
    ],
  });
  editor = new Editor({
    content: "<p>on disk</p>",
    extensions: createBaramExtensions(),
  });
  markContentLoaded(TAB);
});

afterEach(() => {
  vi.useRealTimers();
  editor.destroy();
});

describe("an auto-save timer from before source mode", () => {
  // 이것을 실패시키는 것: `save()` 가 소스 모드를 묻지 않으면 저장한 글을 옛 문서로 덮는다.
  it("does not write over a save made in source mode", async () => {
    const hook = mount();
    typeInDocument();
    toggle(hook);
    typeInSource(hook, "typed in source\n");
    await act(async () => {
      await hook.result.current.handleSave();
    });

    writeFile.mockClear();
    await advance(DELAY * 2);

    expect(new Set(written())).toEqual(new Set(["typed in source\n"]));
    expect(unsaved()).toBe(false);
  });

  // 끝에서 끝까지: 옛 글이 디스크에 있는 틈에 탭은 깨끗하므로 묻지 않고 닫히고, 소스 쪽 타이머도 함께 지워진다.
  it("leaves nothing older on disk for a close right after it fires", async () => {
    const hook = mount();
    typeInDocument();
    await advance(DELAY / 2);
    toggle(hook);
    typeInSource(hook, "typed in source\n");
    await act(async () => {
      await hook.result.current.handleSave();
    });
    await advance(DELAY / 2);
    expect(unsaved()).toBe(false);

    act(() => {
      useEditorStore.getState().closeTab(TAB);
    });
    await advance(DELAY * 2);

    expect(written().at(-1)).toBe("typed in source\n");
  });

  // 이것을 실패시키는 것: 같은 관문. 저장 없이도 소스에서 치는 동안 파일이 한 번 옛 글로 돌아간다.
  it("does not write the older document while the source is being typed in", async () => {
    const hook = mount();
    typeInDocument();
    await advance(DELAY / 2);
    toggle(hook);
    typeInSource(hook, "typed in source\n");

    await advance(DELAY * 2);

    expect(written()).toEqual(["typed in source\n"]);
    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: 타이머를 지우기만 하고 `use-code-auto-save` 가 넘겨받지 않으면 입력해 둔 글이 안 쓰인다.
  // 두 번 쓰이면 한 탭에 두 writer 가 붙은 것이다.
  it("hands what was typed to the source mode's own save, once", async () => {
    const hook = mount();
    typeInDocument();
    toggle(hook);

    await advance(DELAY * 2);

    expect(written()).toHaveLength(1);
    expect(written()[0]).toContain("typed");
    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: 타이머가 표시까지 내리고 돌아가면, 아직 아무도 쓰지 않은 글이 깨끗한 탭에 있다.
  it("leaves the tab unsaved until the source mode's save has written", async () => {
    const hook = mount();
    typeInDocument();
    await advance(DELAY / 2);
    toggle(hook);

    await advance(DELAY / 2);

    expect(written()).toEqual([]);
    expect(unsaved()).toBe(true);
  });

  // The pair: back in WYSIWYG before it fires, the document is the tab's text again.
  it("still writes if the tab came back before it fired", async () => {
    const hook = mount();
    typeInDocument();
    toggle(hook);
    toggle(hook);

    await advance(DELAY * 2);

    expect(written().length).toBeGreaterThan(0);
    for (const content of written()) expect(content).toContain("typed");
    expect(unsaved()).toBe(false);
  });

  // 이것을 실패시키는 것: 복귀가 넘겨받지 않으면 이 타이머는 소스 모드에서 돌아갔고 소스 쪽 타이머는 복귀가 지워,
  // 표시만 켜진 채 아무도 쓰지 않는다. 소스를 잠깐 보고 돌아오는 흔한 동작이다.
  it("has the tab saved if it came back after it fired", async () => {
    const hook = mount();
    typeInDocument();
    await advance(DELAY / 2);
    toggle(hook);
    await advance(DELAY / 2);
    expect(written()).toEqual([]);

    toggle(hook);
    await advance(DELAY * 2);

    expect(written()).toHaveLength(1);
    expect(written()[0]).toContain("typed");
    expect(unsaved()).toBe(false);
  });
});

describe("a tab that has been through source mode", () => {
  // 이것을 실패시키는 것: 기준선을 옮기지 않으면, 소스에서 저장된 글을 손으로 연 때의 글로 되돌렸을 때 디스크와
  // 다른데 탭이 깨끗하다.
  it("compares the next edit with what the source mode saved", async () => {
    const hook = mount();
    const opened = editor.getJSON();
    typeInDocument();
    toggle(hook);
    await advance(DELAY);
    expect(written().at(-1)).toContain("typed");

    toggle(hook);
    await advance(0);
    act(() => {
      editor.commands.setContent(opened);
    });

    expect(unsaved()).toBe(true);
  });

  it("compares it with what the save on the way back wrote too", async () => {
    const hook = mount();
    const opened = editor.getJSON();
    typeInDocument();
    await advance(DELAY / 2);
    toggle(hook);
    await advance(DELAY / 2);

    toggle(hook);
    await advance(0);
    expect(written()).toHaveLength(1);
    act(() => {
      editor.commands.setContent(opened);
    });

    expect(unsaved()).toBe(true);
  });

  // The pair: the file has not changed yet, so that text is not on disk and the older baseline stands.
  it("keeps the baseline if the save on the way back failed", async () => {
    const hook = mount();
    typeInDocument();
    await advance(DELAY / 2);
    toggle(hook);
    await advance(DELAY / 2);
    writeFile.mockRejectedValueOnce(new Error("disk full"));

    toggle(hook);
    await advance(0);

    expect(written()).toHaveLength(1);
    expect(unsaved()).toBe(true);
    expect(getOriginalDoc(TAB)?.textContent).not.toContain("typed");
  });

  // 이것을 실패시키는 것: 숨은 문서의 변경을 세면 AI 채팅 Apply 뒤 표시가 남고 그것을 내릴 저장이 없다.
  it("does not count a change to the document out of sight", async () => {
    const hook = mount();
    toggle(hook);

    act(() => {
      editor.commands.insertContent("applied ");
    });
    await advance(DELAY * 2);

    expect(unsaved()).toBe(false);
    expect(written()).toEqual([]);
  });

  // 이것을 실패시키는 것: 소스 쪽 저장이 관문을 보지 않으면 충돌 질문이 떠 있는 채 외부 변경을 덮는다.
  it("holds the source mode's save while an external change waits for an answer", async () => {
    const hook = mount();
    typeInDocument();
    toggle(hook);
    act(() => {
      useFileStore.getState().updateCanReloadMtime(PATH, Date.now() + 1000);
    });

    await advance(DELAY * 2);

    expect(written()).toEqual([]);
    expect(unsaved()).toBe(true);
  });
});

// The pair: with no source mode in the way, the timer is what saves.
describe("an auto-save timer in WYSIWYG", () => {
  it("writes the document", async () => {
    mount();
    typeInDocument();

    await advance(DELAY);

    expect(written()).toHaveLength(1);
    expect(written()[0]).toContain("typed");
    expect(unsaved()).toBe(false);
  });
});
