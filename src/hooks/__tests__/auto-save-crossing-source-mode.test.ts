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
  COLWIDTH_AUTO_INIT_META,
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

/**
 * What `createColResizePlugin` dispatches once it has measured a table — not an edit, and the
 * widths it writes (`userResized: false`) are not serialized, so the text stays the same.
 */
function measureColumns() {
  act(() => {
    const { state } = editor;
    const { tr } = state;
    state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          colwidth: [120],
          userResized: false,
        });
      }
    });
    expect(tr.docChanged).toBe(true);
    tr.setMeta("addToHistory", false);
    tr.setMeta(COLWIDTH_AUTO_INIT_META, true);
    editor.view.dispatch(tr);
  });
}

/** Holds the next write open until the returned function is called. */
function holdNextWrite(): () => Promise<void> {
  let finish: () => void = () => undefined;
  writeFile.mockImplementationOnce(
    () =>
      new Promise<undefined>((resolve) => {
        finish = () => resolve(undefined);
      }),
  );
  return () =>
    act(async () => {
      finish();
      await Promise.resolve();
      await Promise.resolve();
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

  // §3.5 (#798) 돌아오는 길의 저장이 쓰는 사이 문서에 친 글은 그 쓰기에 없다. 소스 모드가 끝나 버퍼는 더
  // 바뀌지 않으므로, 저장 판정을 버퍼에 물으면 그 글이 저장된 것으로 기록되고 다음 자동 저장 전에 닫으면 묻지
  // 않고 잃는다.
  // 이것을 실패시키는 것: use-source-mode.ts 의 `handBufferToDocument` 가 `outcome` 을 넘기지 않으면(버퍼
  // 판정) 첫째가, `returnedOutcome` 이 설치한 문서 대신 늘 "그대로" 라고 답하면 첫째가 깨진다. 둘째는 같은
  // 저장이 아무도 치지 않았을 때 저장됨을 기록하는 것을 보인다.
  it("keeps the tab unsaved when the document is typed in while the save on the way back writes", async () => {
    const hook = mount();
    toggle(hook);
    typeInSource(hook, "typed in source\n");
    let finish: () => void = () => undefined;
    writeFile.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finish = () => resolve(undefined);
        }),
    );
    toggle(hook);
    await advance(0);
    expect(written()).toEqual(["typed in source\n"]);

    typeInDocument();
    await act(async () => {
      finish();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(unsaved()).toBe(true);
    // The document is live in the editor, so the cache is the file on disk.
    expect(useFileStore.getState().openFiles.get(PATH)).toBe(
      "typed in source\n",
    );
  });

  // §3.5 (#798) source-edited 표시는 buffer 의 것이다. 돌아오는 저장이 쓰는 사이 다시 소스 모드로 들어가 친 글은
  // buffer 에만 있고, 문서가 그대로라는 판정은 그 글에 대해 아무것도 말하지 않는다.
  // 이것을 실패시키는 것: use-code-auto-save.ts 의 `saveFromBuffer` 가 buffer 를 다시 보지 않고 표시를 내리면 깨진다.
  it("keeps the source mark of text typed after going back into source mode during the save on the way back", async () => {
    const hook = mount();
    toggle(hook);
    typeInSource(hook, "typed in source\n");
    const finish = holdNextWrite();
    toggle(hook);
    await advance(0);
    expect(written()).toEqual(["typed in source\n"]);

    toggle(hook);
    typeInSource(hook, "typed in source, again\n");
    await finish();

    expect(useEditorStore.getState().sourceEditedTabs).toEqual([TAB]);
    expect(unsaved()).toBe(true);
  });

  it("has the tab saved when nothing is typed while the save on the way back writes", async () => {
    const hook = mount();
    toggle(hook);
    typeInSource(hook, "typed in source\n");
    toggle(hook);
    await advance(0);

    expect(written()).toEqual(["typed in source\n"]);
    expect(unsaved()).toBe(false);
  });

  // §3.5 (#798) 편집으로 세지 않는 트랜잭션(표 열 폭 측정 · 구문 펼침 · 내용 동기화)은 문서를 바꾸지만 글은
  // 그대로이고 저장을 다시 걸지 않는다. 쓰기가 끝났을 때 그것을 "더 고쳤다" 로 읽으면 탭이 다음 입력까지 "저장 안
  // 됨" 에 남는다. 돌아오는 길의 표는 설치 한 프레임 뒤 측정되므로, 한 프레임보다 긴 쓰기 안에 그것이 든다.
  // 표는 흔히 쓰는 GFM 꼴(`| --- |`)로 친다 — 직렬화는 그것을 `| - |` 로 쓰므로, 비교는 buffer 가 아니라 끼운
  // 문서의 직렬화와 해야 한다.
  // 이것을 실패시키는 것: save-still-current.ts 의 `held.serialize() === …` 를 빼면(`eq` 만 보면), 또는
  // use-source-mode.ts 의 `returnedOutcome` 이 끼운 문서의 직렬화 대신 쓴 buffer 와 비교하면 깨진다.
  it("has the tab saved when the table is measured while the save on the way back writes", async () => {
    const hook = mount();
    toggle(hook);
    typeInSource(hook, "| a |\n| --- |\n| b |\n");
    const finish = holdNextWrite();
    toggle(hook);
    await advance(0);
    expect(written()).toEqual(["| a |\n| --- |\n| b |\n"]);

    measureColumns();
    await finish();

    expect(unsaved()).toBe(false);
    // The baseline is the document the tab holds now, measured widths and all.
    // 이것을 실패시키는 것: use-source-mode.ts 가 `judged.baseline` 대신 끼운 문서를 기준으로 두면 깨진다.
    expect(getOriginalDoc(TAB)?.eq(editor.state.doc)).toBe(true);
  });

  // 이것을 실패시키는 것: 이 자리도 같은 `held.serialize() === written` 이다. 기준 문서 단정은 use-auto-save.ts 가
  // `baseline` 대신 쓸 때의 문서를 기준으로 두면 깨진다 — 다음 편집을 되돌려도 측정한 열 폭 때문에 "저장 안 됨" 이 남는다.
  it("has a WYSIWYG auto-save recorded when the table is measured while it writes", async () => {
    editor.commands.setContent(
      "<table><tbody><tr><th><p>a</p></th></tr><tr><td><p>b</p></td></tr></tbody></table><p>end</p>",
    );
    mount();
    typeInDocument();
    const finish = holdNextWrite();
    await advance(DELAY);
    expect(written()).toHaveLength(1);

    measureColumns();
    await finish();

    expect(unsaved()).toBe(false);
    expect(getOriginalDoc(TAB)?.eq(editor.state.doc)).toBe(true);
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
