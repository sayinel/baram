import { forwardRef, useImperativeHandle, useRef } from "react";

import type { RetainedEntry } from "../../../hooks/use-retained-tabs";
import type { SourceCodeEditorRef } from "../SourceCodeEditor";
import type { TabSurfaceRenderers } from "../tab-surface-renderers";

// §5.1 Cmd+/ 스크롤 함정 — **한 탭에 표면이 둘, 오프셋 슬롯은 하나**였다.
//
// 실앱 증상(비디오가 있는 문서): Cmd+/로 원본을 보면 비디오 아래에서만 스크롤이 진동하고 그
// 위로 올라갈 수 없다. 다시 WYSIWYG으로 오면 반대로 비디오 아래로 내려갈 수 없다.
//
// ‼️ 원인은 비디오가 아니다. `scrollOffsets`는 `tabId` 하나로 색인되는데, 마크다운 탭은
// **좌표계가 다른 두 표면**이 그 탭을 그린다 — 렌더된 WYSIWYG(비디오가 16:9 박스)과 원본
// 텍스트(`![](clip.mp4)` 한 줄)다. 같은 문서인데도 픽셀 높이가 크게 다르므로, 한쪽의 오프셋을
// 다른 쪽에 놓으면 클램프되거나 엉뚱한 곳에 떨어진다. 비디오는 그 높이 차이를 가장 크게
// 만드는 요소일 뿐이고, 큰 이미지도 똑같이 재현한다.
//
// 방향의 비대칭이 바로 그 높이 차의 **부호**다: WYSIWYG이 더 길므로 원본으로 갈 때는
// 넘쳐서(→ 맨 아래로 클램프) 위로 못 가고, 돌아올 때는 모자라서(→ 위쪽에 착지) 아래로 못 간다.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore } from "../../../stores/editor/editor";
import { createTabSurfaceRenderers } from "../tab-surface-renderers";
import { TabSurface } from "../TabSurface";

/** 원본 표면이 놓인 위치. 표면이 스크롤을 건드렸는지 그대로 보여준다. */
const landed = { calls: [] as number[], top: 0 };

/**
 * 원본 텍스트 표면의 스크롤을 흉내내는 CodeMirror 대역.
 *
 * ‼️ `SOURCE_MAX`가 이 테스트의 핵심이다. 원본 텍스트는 렌더된 문서보다 **짧다**. 실제 컨테이너
 * 처럼 scrollTop을 자기 높이로 클램프하므로, WYSIWYG 오프셋을 받으면 맨 아래에 붙는다.
 */
const SOURCE_MAX = 180;

vi.mock("../SourceCodeEditor", () => ({
  SourceCodeEditor: forwardRef<SourceCodeEditorRef>(function Mock(_props, ref) {
    const elRef = useRef<HTMLDivElement | null>(null);
    useImperativeHandle(ref, () => ({
      getContent: () => "",
      getCursorOffset: () => 0,
      getScrollElement: () => elRef.current,
      getScrollTop: () => landed.top,
      hasUserEdited: () => false,
      setScrollTop: (n: number) => {
        landed.calls.push(n);
        landed.top = Math.min(Math.max(n, 0), SOURCE_MAX);
      },
    }));
    return <div className="cm-scroller" ref={elRef} />;
  }),
}));

/** jsdom에는 ResizeObserver가 없다. 통지는 이 테스트의 관심사가 아니므로 비워 둔다. */
class NoopResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}
vi.stubGlobal("ResizeObserver", NoopResizeObserver);

const scrollOffsets = { current: new Map<string, number>() };

const renderers: TabSurfaceRenderers = createTabSurfaceRenderers({
  codeLanguageFor: () => undefined,
  getSourceBuffer: () => "# t\n\n![](assets/clip.mp4)\n",
  hasSourceBuffer: () => true,
  markDirty: vi.fn(),
  onPdfFindApiChange: vi.fn(),
  onTogglePdfFind: vi.fn(),
  pdfFindOpen: false,
  pluginIdFor: () => "",
  scrollOffsets,
  setSourceBuffer: vi.fn(),
  sourceCursorOffsetFor: () => 0,
});

/** Cmd+/로 생기는 원본 표면. tabId는 마크다운 탭과 **같다** — 그게 문제의 전부다. */
const sourceEntry: RetainedEntry = { kind: "code", tabId: "m1" };

beforeEach(() => {
  scrollOffsets.current.clear();
  landed.calls = [];
  landed.top = 0;
  useEditorStore.setState({
    activeTabId: "m1",
    mruOrder: ["m1"],
    tabs: [
      {
        contextId: "c",
        filePath: "/v/note.md",
        id: "m1",
        isDirty: false,
        isPinned: false,
        title: "note.md",
      },
    ],
  });
});

describe("§5.1 Cmd+/ — 원본 표면은 WYSIWYG의 오프셋을 물려받지 않는다", () => {
  it("does not position the source surface from the WYSIWYG offset", () => {
    // MarkdownSurface가 기록해 둔 값이다(사용자가 비디오 아래까지 내려간 자리).
    // 렌더된 문서 좌표계의 900px — 원본 텍스트에는 그만큼의 높이가 없다.
    scrollOffsets.current.set("m1", 900);

    render(
      <TabSurface
        active
        entry={sourceEntry}
        renderers={renderers}
        scrollOffsets={scrollOffsets}
      />,
    );

    // 원본 표면은 자기 좌표계에 저장된 값이 없다 → 스크롤을 건드릴 이유가 없다.
    // 커서 위치(§5.1)가 뷰포트를 정하도록 두어야 한다.
    expect(landed.calls).toEqual([]);
    expect(landed.top).toBe(0);
  });

  it("keeps the WYSIWYG offset intact for the return trip", () => {
    // 돌아올 때 MarkdownSurface가 읽을 값이다. 원본 표면이 자기 클램프된 위치를 이 슬롯에
    // 적어 버리면, WYSIWYG은 원본 좌표계의 숫자를 받아 비디오 위쪽에 갇힌다.
    scrollOffsets.current.set("m1", 900);

    const { container } = render(
      <TabSurface
        active
        entry={sourceEntry}
        renderers={renderers}
        scrollOffsets={scrollOffsets}
      />,
    );

    const scroller = container.querySelector<HTMLElement>(".cm-scroller");
    // 원본 표면 안에서 사용자가 스크롤한다 — 그 값은 원본 좌표계다.
    landed.top = 120;
    scroller?.dispatchEvent(new Event("scroll"));

    expect(scrollOffsets.current.get("m1")).toBe(900);
  });
});
