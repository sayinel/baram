import { useEffect } from "react";

import type { RetainedEntry } from "../../../hooks/use-retained-tabs";
import type { TabSurfaceRenderers } from "../tab-surface-renderers";

// §286 회귀 — 표면은 "미리 마운트"가 아니라 **초기화할 준비가 됐을 때** 마운트한다.
//
// ‼️ 실앱에서 두 가지로 터졌다.
//
//   1. 코드 뷰가 빈 화면. SourceCodeEditor는 마운트 때의 `content`로 EditorState를 굳히고
//      이후 prop을 다시 읽지 않는다(그 파일의 useEffect([]) 주석 참조). 예전에는 App이
//      이 컴포넌트를 lazy()로 불러서 **모듈 로딩이라는 우연한 지연**이 마운트를 버퍼 채우기
//      뒤로 밀어줬다. 직접 import로 바꾸자 빈 버퍼로 마운트되어 영원히 비었다.
//   2. 그래프가 구석으로 뭉침. Cytoscape 인스턴스는 mount-only로 만들어지며 컨테이너를
//      측정하는데, display:none이면 0×0을 잰다.
//
// 그래서 조건을 **데이터/가시성 사실**로 적는다. "한 프레임 기다린다" 같은 추정이 아니다.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore } from "../../../stores/editor/editor";
import { createTabSurfaceRenderers } from "../tab-surface-renderers";
import { TabSurface } from "../TabSurface";

const buffers = new Map<string, string>();

function makeRenderers(): TabSurfaceRenderers {
  return createTabSurfaceRenderers({
    codeLanguageFor: () => undefined,
    getSourceBuffer: (id) => buffers.get(id) ?? "",
    hasSourceBuffer: (id) => buffers.has(id),
    markDirty: vi.fn(),
    onPdfFindApiChange: vi.fn(),
    onTogglePdfFind: vi.fn(),
    pdfFindOpen: false,
    pluginIdFor: () => "",
    setSourceBuffer: vi.fn(),
    sourceCursorOffsetFor: () => 0,
  });
}

vi.mock("../SourceCodeEditor", () => ({
  SourceCodeEditor: ({ content }: { content: string }) => (
    <div data-code={content} />
  ),
}));

const entry = (kind: RetainedEntry["kind"], tabId: string): RetainedEntry => ({
  kind,
  tabId,
});

beforeEach(() => {
  buffers.clear();
  useEditorStore.setState({
    activeTabId: "c1",
    mruOrder: ["c1"],
    tabs: [
      {
        contextId: "c",
        filePath: "/v/a.ts",
        id: "c1",
        isDirty: false,
        isPinned: false,
        title: "a.ts",
      },
    ],
  });
});

describe("code surface waits for its document", () => {
  it("renders no editor while the tab has no buffer yet", () => {
    // 탭이 활성이 된 렌더와 use-tab-switching이 버퍼를 채우는 effect는 같은 커밋이 아니다.
    const { container } = render(
      <TabSurface
        active
        entry={entry("code", "c1")}
        renderers={makeRenderers()}
      />,
    );
    expect(container.querySelector("[data-code]")).toBeNull();
  });

  it("mounts the editor with the real document once the buffer exists", () => {
    buffers.set("c1", "export const a = 1;");
    const { container } = render(
      <TabSurface
        active
        entry={entry("code", "c1")}
        renderers={makeRenderers()}
      />,
    );
    expect(
      container.querySelector("[data-code]")?.getAttribute("data-code"),
    ).toBe("export const a = 1;");
  });

  it("mounts for a genuinely empty file — presence of the buffer is the condition, not its length", () => {
    // 빈 파일도 정당한 문서다. 조건은 "내용이 있는가"가 아니라 "읽어 왔는가"여야 한다.
    buffers.set("c1", "");
    const { container } = render(
      <TabSurface
        active
        entry={entry("code", "c1")}
        renderers={makeRenderers()}
      />,
    );
    expect(container.querySelector("[data-code]")).not.toBeNull();
  });
});

describe("surfaces that measure their container wait to be visible", () => {
  // ‼️ Suspense가 아무것도 안 그리는 것과 구별되도록 **동기 스텁**을 주입해 마운트를 센다.
  let mounts = 0;
  function CountingPdf() {
    useEffect(() => {
      mounts += 1;
    }, []);
    return <div data-pdf="" />;
  }
  const withPdf = (): TabSurfaceRenderers => ({
    ...makeRenderers(),
    pdf: () => <CountingPdf />,
  });

  beforeEach(() => {
    mounts = 0;
  });

  it("does not mount a surface that has never been shown", () => {
    // PdfPreview는 스크롤 컨테이너를 ResizeObserver로 잰다. display:none이면 0×0이다.
    //
    // 그래프도 같은 이유로 여기 있었다 — Cytoscape가 생성 시점에 컨테이너를 잰다. 하지만
    // 그래프는 마운트 이후에도 라이브러리가 스스로 카메라를 흔들어, 유지 대상에서 아예
    // 빠졌다(use-retained-tabs.ts). 이 성질 자체는 남은 kind들에 여전히 필요하다.
    const { container } = render(
      <TabSurface
        active={false}
        entry={entry("pdf", "p1")}
        renderers={withPdf()}
      />,
    );
    expect(mounts).toBe(0);
    expect(container.querySelector("[data-pdf]")).toBeNull();
  });

  it("mounts it as soon as it becomes visible, and only once", () => {
    const r = withPdf();
    const { rerender } = render(
      <TabSurface active={false} entry={entry("pdf", "p1")} renderers={r} />,
    );
    rerender(<TabSurface active entry={entry("pdf", "p1")} renderers={r} />);
    expect(mounts).toBe(1);

    // 유지의 핵심 — 다시 숨겨도 언마운트되지 않는다.
    rerender(
      <TabSurface active={false} entry={entry("pdf", "p1")} renderers={r} />,
    );
    rerender(<TabSurface active entry={entry("pdf", "p1")} renderers={r} />);
    expect(mounts).toBe(1);
  });
});
