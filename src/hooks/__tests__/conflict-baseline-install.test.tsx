/*
 * §3.6 디스크의 새 텍스트를 탭에 설치하면 dirty baseline 도 그 텍스트가 된다.
 *
 * baseline 은 로드할 때 잡힌다(`markContentLoaded` → 첫 트랜잭션의 pending 캡처). 로드가
 * 아닌 길로 문서를 통째로 바꾸면(자동 리로드의 fresh 설치, 충돌 해결) baseline 이 로드 때
 * 문서에 남는다. 그러면 설치 뒤 로드 때 텍스트로 되돌리는 편집이 "baseline 과 같다" 로 읽혀
 * clean 이 된다 — 디스크는 다른 텍스트인데.
 */
import type { Editor } from "@tiptap/core";

import { act, renderHook } from "@testing-library/react";
import { EditorState } from "@tiptap/pm/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  updateFileIndex: () => Promise.resolve(),
  writeFile: () => Promise.resolve(),
}));

import { makeTestEditor } from "../../__tests__/helpers/make-test-editor";
import { markdownToProsemirror } from "../../pipeline";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useSettingsStore } from "../../stores/settings/store";
import {
  clearOriginalDoc,
  markContentLoaded,
  shouldSkipDirty,
} from "../../utils/editor/programmatic-update";
import { serializeLiveDoc } from "../../utils/editor/serialize-live-doc";
import { useAutoSave } from "../use-auto-save";
import { useEditorEffects } from "../use-editor-effects";

const A = "/v/a.md";
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

afterEach(() => {
  clearOriginalDoc("a");
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
