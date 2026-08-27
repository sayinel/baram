// §312 충돌 모달의 "Reload External Changes"는 **소스 표면에서도** 실제로 리로드해야 한다.
//
// ‼️ 이 테스트가 지키는 것은 기능이 아니라 데이터 손실이다. 자동 리로드의 갈라짐 관문은
// "저장되지 않은 편집"과 "사용자가 방금 버리기로 동의한 편집"을 구별하지 못한다. 모달은
// **dirty 탭에서만** 뜨고 dirty 탭의 버퍼는 거의 정의상 갈라져 있으므로, 관문은 사용자가
// 방금 덮어써 달라고 말한 바로 그 탭을 건너뛴다. 그 뒤 `updateLastSaveMtime`이 mtime 가드까지
// 지우므로 다음 Cmd+S가 버려진 로컬 텍스트로 외부 변경을 조용히 되돌린다 — 두 번째 모달도
// 뜨지 않는다.
//
// 동의는 **호출자만 아는 사실**이다. 관문 안에서 dirty 같은 것으로 유추하려 들면 그것이
// 애초에 이 결함을 만든 추론이다. 그래서 `force`를 명시적으로 실어 보낸다.
//
// 단정이 버퍼 **와 마운트된 뷰** 둘 다인 이유: 저장 경로는 버퍼를 읽고 화면은 뷰를 보여
// 준다. 하나만 확인하면 "맵은 맞는데 화면은 옛 텍스트"인 절반짜리 리로드가 초록으로 통과한다.
import type { ReactElement } from "react";
import { useCallback, useEffect, useState } from "react";

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const readFile = vi.fn(async (_path: string) => "");

vi.mock("../../ipc/invoke", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/invoke")>()),
  readFile: (path: string) => readFile(path),
}));

import { EditorView } from "@codemirror/view";

import { SourceCodeEditor } from "../../components/editor/SourceCodeEditor";
import { useEditorStore } from "../../stores/editor/editor";
import { useFileStore } from "../../stores/file/file";
import { triggerAutoReload } from "../use-file-operations";

const PATH = "/v/a.md";
const TAB = "t1";

/** 마지막으로 디스크와 같았던 내용 — 갈라짐 판정의 기준선. */
const ON_DISK_BEFORE = "- [ ] alpha\n";
/** 사용자가 소스 모드에서 친 것 — 아직 저장되지 않았다. */
const LOCAL_EDIT = "- [ ] alpha\n\n로컬에서 친 문단\n";
/** 외부 프로세스가 써 놓은 것 — Reload를 누르면 이것이 보여야 한다. */
const EXTERNAL = "- [x] alpha (외부에서 바뀐 뒤)\n";

const buffers = new Map<string, string>();

/** CodeMirror의 하이라이트 스타일이 마운트 때 prefers-color-scheme을 묻는다. */
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      addEventListener() {},
      matches: false,
      removeEventListener() {},
    }),
    writable: true,
  });

  buffers.clear();
  buffers.set(TAB, LOCAL_EDIT);
  readFile.mockClear();
  readFile.mockResolvedValue(EXTERNAL);

  useFileStore.setState({ openFiles: new Map([[PATH, ON_DISK_BEFORE]]) });
  useEditorStore.setState({
    activeTabId: TAB,
    mruOrder: [],
    sourceBufferAccess: null,
    sourceModeTabs: [TAB],
    tabs: [
      {
        contextId: "c",
        filePath: PATH,
        id: TAB,
        // 모달은 dirty 탭에서만 뜬다 — 이 픽스처가 재현하는 상황 그대로다.
        isDirty: true,
        isPinned: false,
        title: "a",
      },
    ],
  });
});

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** 두 프레임을 흘려 두 단계 init(포커스 → 아티팩트 청소)을 끝낸다. */
async function flushInit() {
  await act(async () => {
    await nextFrame();
    await nextFrame();
  });
}

/**
 * App과 같은 모양의 배선 — `useSourceMode`가 스토어에 게시하는 접근자 두 개와,
 * `tab-surface-renderers.tsx`가 표면에 넘기는 스냅샷/접근자 두 갈래.
 */
function Harness(): ReactElement {
  const [, bump] = useState(0);
  const getSourceBuffer = useCallback(
    (id: string) => buffers.get(id) ?? "",
    [],
  );
  const setSourceBuffer = useCallback((id: string, content: string) => {
    buffers.set(id, content);
    bump((v) => v + 1);
  }, []);

  useEffect(() => {
    const access = { getSourceBuffer, setSourceBuffer };
    useEditorStore.getState().registerSourceBufferAccess(access);
    return () => {
      if (useEditorStore.getState().sourceBufferAccess === access) {
        useEditorStore.getState().registerSourceBufferAccess(null);
      }
    };
  }, [getSourceBuffer, setSourceBuffer]);

  return (
    <SourceCodeEditor
      content={getSourceBuffer(TAB)}
      getLatestContent={() => getSourceBuffer(TAB)}
      onChange={(next) => setSourceBuffer(TAB, next)}
    />
  );
}

function viewOf(container: HTMLElement): EditorView {
  const el = container.querySelector<HTMLElement>(".cm-content");
  const found = el ? EditorView.findFromDOM(el) : null;
  if (!found) throw new Error("CodeMirror view not found");
  return found;
}

describe("conflict modal — Reload discards local edits on the source surface", () => {
  it("puts the external text in the buffer AND in the mounted view", async () => {
    const view = render(<Harness />);
    await flushInit();
    // 화면이 정말 로컬 편집을 들고 있는 상태에서 출발한다.
    expect(viewOf(view.container).state.doc.toString()).toBe(LOCAL_EDIT);

    // 사용자가 "Reload External Changes"를 눌렀다 — 동의가 있으므로 force.
    await act(async () => {
      await triggerAutoReload(PATH, 999, { force: true });
    });

    expect(buffers.get(TAB)).toBe(EXTERNAL);
    expect(viewOf(view.container).state.doc.toString()).toBe(EXTERNAL);
  });

  it("still protects an unsaved edit when nobody consented", async () => {
    // 같은 픽스처, force만 없다. 워처의 자동 리로드는 동의를 받은 적이 없으므로
    // 갈라진 버퍼를 덮으면 안 된다 — force가 전역 우회가 되지 않았음을 이 쌍이 증명한다.
    const view = render(<Harness />);
    await flushInit();

    await act(async () => {
      await triggerAutoReload(PATH, 999);
    });

    expect(buffers.get(TAB)).toBe(LOCAL_EDIT);
    expect(viewOf(view.container).state.doc.toString()).toBe(LOCAL_EDIT);
  });
});
