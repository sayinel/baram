import type { RetainedEntry } from "../../../hooks/use-retained-tabs";
import type { TabSurfaceRenderers } from "../tab-surface-renderers";

// §291 위치는 **상한과 무관하게** 살아남는다.
//
// ‼️ 유지 상한(RETENTION_CAPS)은 "재로딩을 얼마나 피할 것인가"의 문제여야지, "자리를 잃느냐"의
// 문제여서는 안 된다. 세 번째 PDF나 HTML을 열면 가장 오래된 표면이 축출되는데, 오프셋 맵이
// 그 컴포넌트 안에 살면 위치도 함께 사라져 돌아갔을 때 맨 위로 간다 — 원래 불편이 그대로다.
//
// 그래서 맵을 App이 소유하고 모든 표면이 공유한다. 축출된 탭은 다시 로드되긴 하지만 **보던
// 자리로 착지**한다.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore } from "../../../stores/editor/editor";
import { createTabSurfaceRenderers } from "../tab-surface-renderers";
import { TabSurface } from "../TabSurface";

vi.mock("../SourceCodeEditor", () => ({
  SourceCodeEditor: () => <div data-code="" />,
}));

const scrollOffsets = { current: new Map<string, number>() };

const renderers: TabSurfaceRenderers = createTabSurfaceRenderers({
  codeLanguageFor: () => undefined,
  getSourceBuffer: () => "",
  hasSourceBuffer: () => true,
  markDirty: vi.fn(),
  markSourceEdited: vi.fn(),
  onPdfFindApiChange: vi.fn(),
  onTogglePdfFind: vi.fn(),
  pdfFindOpen: false,
  pluginIdFor: () => "",
  scrollOffsets,
  setSourceBuffer: vi.fn(),
  sourceCursorOffsetFor: () => 0,
});

const entry: RetainedEntry = { kind: "pdf", tabId: "p1" };

beforeEach(() => {
  scrollOffsets.current.clear();
  useEditorStore.setState({
    activeTabId: "p1",
    mruOrder: ["p1"],
    tabs: [
      {
        contextId: "c",
        filePath: "/v/a.pdf",
        id: "p1",
        isDirty: false,
        isPinned: false,
        title: "a.pdf",
      },
    ],
  });
});

describe("a surface's offset outlives the surface", () => {
  it("keeps the recorded offset after the surface unmounts (eviction)", () => {
    const { unmount } = render(
      <TabSurface
        active
        entry={entry}
        renderers={renderers}
        scrollOffsets={scrollOffsets}
      />,
    );
    scrollOffsets.current.set("p1", 512);
    unmount();
    // 축출은 컴포넌트를 없애지만, 자리는 App이 들고 있어야 한다.
    expect(scrollOffsets.current.get("p1")).toBe(512);
  });

  it("restores that offset when the tab is opened again", () => {
    scrollOffsets.current.set("p1", 512);
    const { container } = render(
      <TabSurface
        active
        entry={entry}
        renderers={renderers}
        scrollOffsets={scrollOffsets}
      />,
    );
    const wrapper = container.querySelector<HTMLElement>(".editor-area-scroll");
    expect(wrapper?.scrollTop).toBe(512);
  });
});
