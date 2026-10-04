/*
 * §3.6 디스크의 새 텍스트를 탭에 설치하면 dirty baseline 도 그 텍스트가 된다.
 *
 * baseline 은 로드할 때 잡힌다(`markContentLoaded` → 첫 트랜잭션의 pending 캡처). 로드가
 * 아닌 길로 문서를 통째로 바꾸면(자동 리로드의 fresh 설치, 충돌 해결) baseline 이 로드 때
 * 문서에 남는다. 그러면 설치 뒤 로드 때 텍스트로 되돌리는 편집이 "baseline 과 같다" 로 읽혀
 * clean 이 된다 — 디스크는 다른 텍스트인데.
 */
import type { Editor } from "@tiptap/core";

import { act, renderHook, waitFor } from "@testing-library/react";
import { undoDepth } from "@tiptap/pm/history";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: () => Promise.resolve(),
  writeFile: () => Promise.resolve(),
}));

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { markdownToProsemirror } from "../../pipeline";
import { adoptDiskTextIntoTab } from "../../services/conflict-adopt";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import {
  clearOriginalDoc,
  markContentLoaded,
  shouldSkipDirty,
} from "../../utils/editor/programmatic-update";
import {
  serializeEditorState,
  serializeLiveDoc,
} from "../../utils/editor/serialize-live-doc";
import { resumeKeepaliveTab } from "../tab-switching/resume-keepalive-tab";
import { installContent } from "../tab-switching/types";
import { useAutoSave } from "../use-auto-save";
import { useEditorEffects } from "../use-editor-effects";
import { createKeepalivePool } from "../use-large-doc-keepalive";
import { useTabSwitching } from "../use-tab-switching";

const A = "/v/a.md";
const B = "/v/b.md";
const MERGED = "Merged text\n";
const LOADED = "Loaded text\n";
const ON_DISK = "Text the disk says now\n";

let editor: Editor;
const editorStateCache = new Map<string, EditorState>();

const fileTab = (id: string, filePath: string, isDirty = false) => ({
  contextId: "c",
  filePath,
  id,
  isDirty,
  isPinned: false,
  title: id,
});

const isDirty = (id: string) =>
  useEditorStore.getState().tabs.find((t) => t.id === id)!.isDirty;

/** 로드: 문서를 설치하고 baseline 캡처를 세운 뒤, 정규화 한 번으로 그것을 소비한다. */
function load(md: string, tabId: string) {
  editor.view.updateState(
    EditorState.create({
      doc: markdownToProsemirror(md, editor.schema),
      plugins: editor.state.plugins,
    }),
  );
  markContentLoaded(tabId);
  shouldSkipDirty(tabId, editor.state.doc);
}

/** 문서를 통째로 `md` 로 바꾸는 사용자 편집 — 트랜잭션 하나. */
function editTo(md: string) {
  const doc = markdownToProsemirror(md, editor.schema);
  editor.view.dispatch(
    editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content),
  );
}

function mount() {
  return renderHook(() => {
    useEditorEffects({
      editor,
      editorStateCache: { current: editorStateCache },
      inlineAI: { applyContent: vi.fn(), previewInsertAfterSelection: vi.fn() },
      setFindReplaceMode: vi.fn(),
      setFindReplaceOpen: vi.fn(),
    });
    useAutoSave(editor);
  });
}

beforeEach(() => {
  editorStateCache.clear();
  editor = makeTestEditor("<p></p>");
  useSettingsStore.setState({ autoSave: false } as never);
  useFileStore.setState({ fileMtimes: new Map(), openFiles: new Map() });
  useEditorStore.setState({
    activeTabId: "a",
    mruOrder: [],
    sourceEditedTabs: [],
    sourceModeTabs: [],
    staleContentTabs: [],
    tabs: [fileTab("a", A)],
  });
});

afterEach(async () => {
  // 탭 전환은 스크롤 복원을 `requestAnimationFrame` 에 예약한다 — 에디터를 부수기 전에 돈다.
  await new Promise((resolve) => setTimeout(resolve, 30));
  clearOriginalDoc("a");
  clearOriginalDoc("b");
  editor.destroy();
});

describe("§3.6 a clean auto-reload takes a fresh baseline", () => {
  it("h: editing back to the load-time text after a reload is dirty", async () => {
    // 이것을 실패시키는 것: refresh consumer 의 `markBaselinePending` 제거(로드 때 baseline 이
    // 남아 되돌린 문서가 clean 으로 읽힌다).
    load(LOADED, "a");
    useFileStore.getState().setFileContent(A, ON_DISK);
    const h = mount();

    act(() => {
      useEditorStore.getState().requestContentRefresh("fresh", A);
    });
    expect(serializeLiveDoc(editor)).toBe(ON_DISK);
    expect(isDirty("a")).toBe(false);

    act(() => editTo(LOADED));

    expect(serializeLiveDoc(editor)).toBe(LOADED);
    expect(isDirty("a")).toBe(true);
    h.unmount();
  });

  it("a dirty tab refreshed with its own unsaved text keeps the disk baseline", () => {
    // PropertiesPanel 처럼 저장 안 된 텍스트로 refresh 하는 호출자: 탭은 이미 dirty 다. 그
    // baseline 은 디스크의 문서로 남아야 한다 — 새로 설치한 저장 안 된 문서를 baseline 으로
    // 흡수하면 그 뒤의 비교가 저장 안 된 텍스트를 "변경 없음" 으로 읽는다.
    // 이것을 실패시키는 것: consumer 의 `!isTabUnsaved` 조건 제거(pending 이 다음 update 에서
    // 설치된 문서를 baseline 으로 잡아 `shouldSkipDirty` 가 true).
    load(LOADED, "a");
    useFileStore
      .getState()
      .setFileContent(A, "---\ntags: x\n---\n\nLoaded text\n");
    useEditorStore.getState().markDirty("a", true);
    const h = mount();

    act(() => {
      useEditorStore.getState().requestContentRefresh();
    });

    expect(serializeLiveDoc(editor)).toContain("tags: x");
    expect(shouldSkipDirty("a", editor.state.doc)).toBe(false);
    h.unmount();
  });
});

describe("§3.6 a conflict's text is installed where the tab's document lives", () => {
  let pooled: Editor | null = null;

  /** 문서 표면 등록 — `useTabSwitching` 이 하는 일을 손으로. */
  function registerSurfaces() {
    useEditorStore.setState({
      documentSurfaceAccess: {
        editor,
        editorStateCache,
        isKeepaliveComplete: () => true,
        keepaliveEditor: (id) => (id === "a" ? pooled : null),
      },
    });
  }

  beforeEach(() => {
    pooled = null;
    useFileStore.getState().setFileContent(A, LOADED);
    useFileStore.getState().setFileContent(B, "B body\n");
    useEditorStore.setState({
      tabs: [fileTab("a", A, true), fileTab("b", B, true)],
    });
    registerSurfaces();
  });

  afterEach(async () => {
    // 재개는 스크롤 복원을 `requestAnimationFrame` 에 예약한다 — pool editor 를 부수기 전에 돈다.
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (pooled && !pooled.isDestroyed) pooled.destroy();
  });

  it("a: the active tab's view holds the text at once, and editing back to the old text is dirty", () => {
    // 이것을 실패시키는 것: adopt 의 `markBaselinePending` 제거(로드 때 baseline 이 남는다).
    load(LOADED, "a");
    const h = mount();

    act(() => {
      adoptDiskTextIntoTab("a", A, MERGED);
    });
    expect(serializeLiveDoc(editor)).toBe(MERGED);
    expect(isDirty("a")).toBe(false);

    act(() => editTo(LOADED));
    expect(isDirty("a")).toBe(true);
    h.unmount();
  });

  it("b: a normalizing transaction after the install does not mark it dirty", () => {
    // 직렬화가 같은 트랜잭션(blockId "" — 마크다운에 나오지 않는다).
    // 이것을 실패시키는 것: adopt 의 `markBaselinePending` 을 `noteContentSync` 로(설치된 문서에
    // baseline 을 고정해 정규화가 가짜 dirty 가 된다).
    load(LOADED, "a");
    const h = mount();
    act(() => {
      adoptDiskTextIntoTab("a", A, MERGED);
    });

    act(() => {
      editor.view.dispatch(editor.state.tr.setNodeAttribute(0, "blockId", ""));
    });

    expect(serializeLiveDoc(editor)).toBe(MERGED);
    expect(isDirty("a")).toBe(false);
    h.unmount();
  });

  it("c: an active keep-alive tab gets the text in its own editor", () => {
    // 이것을 실패시키는 것: 설치 대상을 언제나 shared editor 로.
    load("B body\n", "b");
    pooled = makeTestEditor("<p>Loaded text</p>");
    markContentLoaded("a");

    adoptDiskTextIntoTab("a", A, MERGED);

    expect(serializeLiveDoc(pooled)).toBe(MERGED);
    expect(serializeLiveDoc(editor)).toBe("B body\n");
  });

  it("d: a background keep-alive tab is patched on resume; its baseline follows (characterization)", () => {
    // 재개의 pending 캡처와 patch 의 content-sync 가 이미 baseline 을 맞춘다 — 재개 뒤에
    // `noteContentSync` 를 더할 이유가 없다는 근거. 이것을 실패시키는 것: 재개의 stale 갈래에서
    // `patchEditorContent` 제거(낡은 문서가 남는다).
    pooled = makeTestEditor("<p>Loaded text</p>");
    useEditorStore.setState({ activeTabId: "b" });
    adoptDiskTextIntoTab("a", A, MERGED);
    expect(useEditorStore.getState().staleContentTabs).toContain("a");

    useEditorStore.setState({ activeTabId: "a" });
    const h = renderHook(() => useAutoSave(pooled));
    const ctx = {
      installContent,
      onActiveEditorChange: () => undefined,
      scrollOffsets: { current: new Map<string, number>() },
    } as unknown as Parameters<typeof resumeKeepaliveTab>[0];
    act(() => resumeKeepaliveTab(ctx, "a", pooled!, fileTab("a", A)));

    expect(serializeLiveDoc(pooled)).toBe(MERGED);
    const merged = pooled.state.doc;
    act(() => {
      pooled!.commands.insertContentAt(pooled!.state.doc.content.size - 1, "!");
    });
    expect(shouldSkipDirty("a", pooled.state.doc)).toBe(false);
    expect(shouldSkipDirty("a", merged)).toBe(true);
    h.unmount();
  });

  it("e: switching away right after the adopt keeps the merged text in the cache", async () => {
    // 이것을 실패시키는 것: adopt 의 설치를 `requestContentRefresh("fresh", path)` 로 되돌림
    // (passive effect 가 돌기 전에 나가는 탭 처리가 병합 전 문서를 cache·`openFiles` 에 쓴다).
    load(LOADED, "a");
    editorStateCache.set(
      "b",
      EditorState.create({
        doc: markdownToProsemirror("B body\n", editor.schema),
        plugins: editor.state.plugins,
      }),
    );
    const h = mountSwitching();

    act(() => {
      adoptDiskTextIntoTab("a", A, MERGED);
      useEditorStore.setState({ activeTabId: "b", mruOrder: ["b", "a"] });
    });
    await waitFor(() => expect(serializeLiveDoc(editor)).toBe("B body\n"));

    expect(serializeEditorState(editorStateCache.get("a")!)).toBe(MERGED);
    expect(useFileStore.getState().openFiles.get(A)).toBe(MERGED);

    act(() => {
      useEditorStore.setState({ activeTabId: "a", mruOrder: ["a", "b"] });
    });
    await waitFor(() => expect(serializeLiveDoc(editor)).toBe(MERGED));
    h.unmount();
  });

  it("f: the active fresh install starts a new history", () => {
    // 이것을 실패시키는 것: 활성 탭 설치를 patch(`patchEditorContent`)로 — 히스토리가 남는다.
    load(LOADED, "a");
    act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!");
    });
    expect(undoDepth(editor.state)).toBeGreaterThan(0);

    adoptDiskTextIntoTab("a", A, MERGED);

    expect(undoDepth(editor.state)).toBe(0);
  });

  it("g: a background tab is marked stale and shows the text when it comes back", async () => {
    // 이것을 실패시키는 것: 배경 adopt 에서 `markContentStale` 제거(돌아오면 cache 의 옛 문서).
    load("B body\n", "b");
    editorStateCache.set(
      "a",
      EditorState.create({
        doc: markdownToProsemirror(LOADED, editor.schema),
        plugins: editor.state.plugins,
      }),
    );
    useEditorStore.setState({ activeTabId: "b", mruOrder: ["b", "a"] });
    const h = mountSwitching();

    adoptDiskTextIntoTab("a", A, MERGED);
    act(() => {
      useEditorStore.setState({ activeTabId: "a", mruOrder: ["a", "b"] });
    });

    await waitFor(() => expect(serializeLiveDoc(editor)).toBe(MERGED));
    h.unmount();
  });

  function mountSwitching() {
    return renderHook(() => {
      useTabSwitching({
        appendHandleRef: { current: null },
        createKeepaliveEditor: () => editor,
        editor,
        editorStateCache: { current: editorStateCache },
        getSourceBuffer: () => "",
        isNavBackForwardRef: { current: false },
        keepalive: createKeepalivePool(),
        onActiveEditorChange: vi.fn(),
        scrollOffsets: { current: new Map<string, number>() },
        setFindReplaceMode: vi.fn(),
        setFindReplaceOpen: vi.fn(),
        setIsParsing: vi.fn(),
        setSourceBuffer: vi.fn(),
        sourceModeTabs: new Set<string>(),
      });
      // useTabSwitching 이 자기 표면을 등록한다 — pool 을 쓰는 케이스는 위에서 손으로 등록한다.
    });
  }
});
