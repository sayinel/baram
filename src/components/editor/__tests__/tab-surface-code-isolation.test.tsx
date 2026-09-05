// §287/§289.4 — 코드 표면 두 개가 동시에 마운트돼도 서로의 파일을 침범하지 않는다.
//
// ‼️ 이 테스트가 지키는 것은 기능이 아니라 데이터 손실이다. 전역 버퍼 하나 위에 코드 표면을
// 둘 이상 올리면, 마지막에 타이핑한 표면이 그 버퍼를 쥐고 자동 저장이 **활성 탭 경로에**
// 그것을 쓴다. 이 저장소는 "버퍼에만 쓰고 디스크에 못 닿는" 계열의 사고를 이미 겪었다.
//
// 단정은 setSourceBuffer가 받은 (tabId, 내용) 쌍이다 — 호출 여부가 아니라 **짝**을 본다.
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ‼️ 대체하는 것은 **리프 컴포넌트 하나뿐**이다. 검사 대상인 createTabSurfaceRenderers의
// `code` 렌더러는 진짜를 쓴다 — 렌더러까지 스텁으로 덮으면 이 테스트는 자기 스텁의 배선을
// 확인하게 되고, 프로덕션 배선이 뒤바뀌어도 초록으로 남는다. CodeMirror를 jsdom에서 띄우는
// 비용만 피하고, "어느 tabId로 배선됐는가"라는 성질은 진짜 코드가 결정하게 둔다.
vi.mock("../SourceCodeEditor", () => ({
  SourceCodeEditor: ({
    content,
    onChange,
  }: {
    content: string;
    onChange: (next: string) => void;
  }) => (
    <textarea
      data-code={content}
      onChange={(e) => onChange(e.target.value)}
      value={content}
    />
  ),
}));

import type { RetainedEntry } from "../../../hooks/use-retained-tabs";
import type { TabSurfaceRenderers } from "../tab-surface-renderers";

import { useEditorStore } from "../../../stores/editor/editor";
import { createTabSurfaceRenderers } from "../tab-surface-renderers";
import { TabSurface } from "../TabSurface";

const setSourceBuffer = vi.fn();
const markDirty = vi.fn();

const buffers: Record<string, string> = {
  a: "print('A')",
  b: "print('B')",
};

const renderers: TabSurfaceRenderers = createTabSurfaceRenderers({
  codeLanguageFor: () => undefined,
  getSourceBuffer: (id) => buffers[id] ?? "",
  hasSourceBuffer: (id) => id in buffers,
  markDirty,
  markSourceEdited: vi.fn(),
  onPdfFindApiChange: vi.fn(),
  onTogglePdfFind: vi.fn(),
  pdfFindOpen: false,
  pluginIdFor: () => "",
  scrollOffsets: { current: new Map<string, number>() },
  setSourceBuffer,
  sourceCursorOffsetFor: () => 0,
});

const entryFor = (tabId: string): RetainedEntry => ({ kind: "code", tabId });

beforeEach(() => {
  setSourceBuffer.mockClear();
  markDirty.mockClear();
  useEditorStore.setState({
    activeTabId: "a",
    mruOrder: ["a", "b"],
    tabs: [
      {
        contextId: "c",
        filePath: "/v/a.py",
        id: "a",
        isDirty: false,
        isPinned: false,
        title: "a",
      },
      {
        contextId: "c",
        filePath: "/v/b.py",
        id: "b",
        isDirty: false,
        isPinned: false,
        title: "b",
      },
    ],
  });
});

describe("two mounted code surfaces", () => {
  /**
   * 실제 순서를 따른다: B를 먼저 열어(활성) 마운트시킨 뒤 A로 옮겨 B가 숨겨진 상태를 만든다.
   *
   * ‼️ 처음부터 active={false}로 렌더하면 안 된다 — 유지는 "미리 마운트"가 아니라 "한 번 보인
   * 뒤로는 언마운트하지 않는다"이므로, 한 번도 활성이 아니었던 표면은 아예 마운트되지 않는다.
   */
  function mountBothWithBHidden() {
    const view = render(
      <>
        <TabSurface
          active={false}
          entry={entryFor("a")}
          renderers={renderers}
        />
        <TabSurface active entry={entryFor("b")} renderers={renderers} />
      </>,
    );
    view.rerender(
      <>
        <TabSurface active entry={entryFor("a")} renderers={renderers} />
        <TabSurface
          active={false}
          entry={entryFor("b")}
          renderers={renderers}
        />
      </>,
    );
    return view;
  }

  it("routes each surface's edit to its OWN tab", () => {
    const { container } = mountBothWithBHidden();

    // 숨은 표면 B가 편집된다(플러그인·외부 이벤트로 실제로 일어날 수 있다).
    // content가 B의 버퍼라는 것 자체가 "렌더러가 자기 탭에서 읽었다"의 증거다.
    const hidden = container.querySelector<HTMLTextAreaElement>(
      `[data-code="${buffers.b}"]`,
    );
    expect(hidden).not.toBeNull();
    fireEvent.change(hidden!, { target: { value: "print('B edited')" } });

    // 활성 탭은 A인데, 편집은 B의 버퍼로 가야 한다.
    expect(setSourceBuffer).toHaveBeenCalledWith("b", "print('B edited')");
    expect(setSourceBuffer).not.toHaveBeenCalledWith("a", "print('B edited')");
    expect(markDirty).toHaveBeenCalledWith("b", true);
    expect(markDirty).not.toHaveBeenCalledWith("a", true);
  });

  it("mounts both surfaces at once — the precondition this guards", () => {
    // 이 단정이 깨지면 위 테스트는 "숨은 표면이 없어서" 통과한다.
    const { container } = mountBothWithBHidden();
    expect(container.querySelectorAll("[data-code]")).toHaveLength(2);
  });
});
