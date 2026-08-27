// §312/§3.6 자동 저장은 `openFiles`를 최신으로 유지해야 한다 — 그것이 자동 리로드의
// 갈라짐 판정 기준선이기 때문이다.
//
// ‼️ 이 테스트가 지키는 것은 기능이 아니라 **디스크의 데이터**다. 자동 저장은
// `writeFile` + `markDirty(false)`만 하고 `setFileContent`를 부르지 않아, 저장 한 번마다
// 캐시가 낡는다(autoSave 기본값은 true다). 그 뒤 Cmd+/로 소스 모드에 들어가면 버퍼는
// **라이브 PM 문서의 직렬화**로 채워지므로(use-source-mode.ts) 캐시와 다르다. 이제 그
// 파일에 외부 변경이 오면:
//
//   탭은 clean → 워처가 자동 리로드 → 관문이 "버퍼가 갈라졌다"고 **오판**해 건너뛴다
//   → 그런데 `lastSaveMtime`은 외부 mtime으로 올라간다(mtime 가드 해제)
//   → 다음 저장이 옛 버퍼로 외부 변경을 덮는다. 충돌 모달은 한 번도 뜨지 않는다.
//
// 그래서 단정은 두 개다: 사용자가 외부 변경을 **보는가**(버퍼), 그리고 그 다음 저장이
// 외부 변경을 **디스크에서 지우지 않는가**(writeFile 인자).
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn(async (_path: string) => "");
const writeFile = vi.fn(async (_path: string, _content: string) => {});
const updateFileIndex = vi.fn(async (_path: string) => {});

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => readFile(path),
  updateFileIndex: (path: string) => updateFileIndex(path),
  writeFile: (path: string, content: string) => writeFile(path, content),
}));

import { Editor } from "@tiptap/core";

import { createBaramExtensions } from "../../extensions";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { useAutoSave } from "../use-auto-save";
import { triggerAutoReload, useFileOperations } from "../use-file-operations";

const PATH = "/v/a.md";
const TAB = "t1";

/** 파일을 열었을 때의 내용 — 자동 저장 전에는 이것이 캐시이자 디스크다. */
const OPENED = "hello\n";
/** 외부 프로세스가 나중에 써 놓는 내용. */
const EXTERNAL = "hello, from another process\n";

const buffers = new Map<string, string>();

beforeEach(() => {
  buffers.clear();
  readFile.mockClear();
  readFile.mockResolvedValue(EXTERNAL);
  writeFile.mockClear();
  updateFileIndex.mockClear();

  useFileStore.setState({
    fileMtimes: new Map(),
    openFiles: new Map([[PATH, OPENED]]),
  });
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [],
    sourceBufferAccess: {
      getSourceBuffer: (id) => buffers.get(id) ?? "",
      setSourceBuffer: (id, content) => {
        buffers.set(id, content);
      },
    },
    sourceModeTabs: [TAB],
    tabs: [
      {
        contextId: "c",
        filePath: PATH,
        id: TAB,
        isDirty: false,
        isPinned: false,
        title: "a",
      },
    ],
  });
});

describe("auto-save keeps the auto-reload baseline honest", () => {
  it("an external change still reaches the source buffer after an auto-save", async () => {
    const editor = new Editor({
      content: "<p>hello</p>",
      extensions: createBaramExtensions(),
    });
    const autoSave = renderHook(() => useAutoSave(editor));

    // ① 사용자가 WYSIWYG에서 타이핑한다 → 자동 저장이 예약되고, 여기서는 그 디바운스를
    //    기다리는 대신 같은 함수를 직접 부른다.
    await act(async () => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!");
    });
    await act(async () => {
      await autoSave.result.current.save();
    });
    const autoSaved = writeFile.mock.calls.at(-1)?.[1];
    expect(autoSaved).toBeDefined();
    expect(autoSaved).not.toBe(OPENED);

    // ② Cmd+/ — 버퍼는 **라이브 문서**에서 채워진다(캐시가 아니다).
    buffers.set(TAB, autoSaved as string);

    // ③ 외부 변경이 도착한다. 탭은 자동 저장 직후라 clean이므로 워처는 자동 리로드로 간다.
    await act(async () => {
      await triggerAutoReload(PATH, 999);
    });

    // 사용자가 보고 있는 텍스트가 외부 변경이어야 한다 — 화면과 저장 경로가 둘 다 이 버퍼다.
    expect(buffers.get(TAB)).toBe(EXTERNAL);

    // ④ 그리고 그 다음 저장이 외부 변경을 디스크에서 지우면 안 된다.
    const ops = renderHook(() =>
      useFileOperations({
        editor,
        getSourceBuffer: (id: string) => buffers.get(id) ?? "",
        sourceModeTabs: new Set([TAB]),
      }),
    );
    await act(async () => {
      await ops.result.current.handleSave();
    });
    expect(writeFile.mock.calls.at(-1)?.[1]).toBe(EXTERNAL);

    ops.unmount();
    autoSave.unmount();
    editor.destroy();
  });
});
