import { useEffect } from "react";

import type { RetainedEntry } from "../../../hooks/use-retained-tabs";
import type { TabSurfaceRenderers } from "../tab-surface-renderers";

// §286 — PDF 표면은 다른 탭이 활성인 동안에도 마운트를 유지한다.
//
// ‼️ pdfjs를 vi.mock으로 덮지 않는다. 이 저장소는 "경로 전체를 mock으로 덮으면 그 기능이
// 실앱에서 완전히 죽어도 스위트는 초록"인 사고를 이미 겪었다 — PDF 찾기가 4,988개 초록
// 아래에서 0/0이었다. 대신 렌더러를 **주입**해 검사 대상을 TabSurface의 배선으로 좁힌다.
// pdfjs 실물은 실앱 확인이 책임진다.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore } from "../../../stores/editor/editor";
import { useFileStore } from "../../../stores/file/file";
import { createTabSurfaceRenderers } from "../tab-surface-renderers";
import { TabSurface } from "../TabSurface";

let pdfMounts = 0;

// ‼️ ctx를 모듈 변수에 담지 않는다. 렌더 중 외부 변수를 재할당하는 것은 side effect이고
// (react-hooks/globals가 막는다) 무엇보다 관찰 가능한 출력으로 단정하는 편이 강하다 —
// 표면이 무엇을 받았는지를 DOM에 그대로 적어 두고 그것을 읽는다.
function CountingPdf(ctx: {
  filePath: string;
  refreshKey: number;
  tabId: string;
}) {
  useEffect(() => {
    pdfMounts += 1;
  }, []);
  return (
    <div
      data-pdf={ctx.tabId}
      data-pdf-path={ctx.filePath}
      data-pdf-refresh={String(ctx.refreshKey)}
    />
  );
}

const renderers: TabSurfaceRenderers = {
  ...createTabSurfaceRenderers({
    codeLanguageFor: () => undefined,
    getSourceBuffer: () => "",
    hasSourceBuffer: () => true,
    markDirty: vi.fn(),
    onPdfFindApiChange: vi.fn(),
    onTogglePdfFind: vi.fn(),
    pdfFindOpen: false,
    pluginIdFor: () => "",
    scrollOffsets: { current: new Map<string, number>() },
    setSourceBuffer: vi.fn(),
    sourceCursorOffsetFor: () => 0,
  }),
  pdf: (ctx) => <CountingPdf {...ctx} />,
};

const entry: RetainedEntry = { kind: "pdf", tabId: "p1" };

function surface(active: boolean) {
  return <TabSurface active={active} entry={entry} renderers={renderers} />;
}

beforeEach(() => {
  pdfMounts = 0;
  useEditorStore.setState({
    activeTabId: "p1",
    mruOrder: ["p1"],
    tabs: [
      {
        contextId: "ctx",
        filePath: "/v/1.pdf",
        id: "p1",
        isDirty: false,
        isPinned: false,
        title: "1.pdf",
      },
      {
        contextId: "ctx",
        filePath: "/v/note.md",
        id: "m1",
        isDirty: false,
        isPinned: false,
        title: "note.md",
      },
    ],
  });
  useFileStore.setState({
    fileMtimes: new Map([
      ["/v/1.pdf", { canReloadMtime: 0, lastSaveMtime: 111 }],
      ["/v/note.md", { canReloadMtime: 0, lastSaveMtime: 999 }],
    ]),
  });
});

describe("TabSurface (pdf)", () => {
  it("mounts the pdf surface exactly once across an active→inactive→active round trip", () => {
    const { rerender } = render(surface(true));
    expect(pdfMounts).toBe(1);
    rerender(surface(false));
    rerender(surface(true));
    // 재마운트가 있었다면 2가 된다 — 그것이 곧 "돌아올 때마다 다시 로딩"의 원인이다.
    expect(pdfMounts).toBe(1);
  });

  it("keeps the same wrapper DOM node across the round trip", () => {
    const { container, rerender } = render(surface(true));
    const wrapper = container.querySelector(".editor-area-scroll");
    rerender(surface(false));
    rerender(surface(true));
    expect(container.querySelector(".editor-area-scroll")).toBe(wrapper);
  });

  it("hides the wrapper and drops data-editor-active while inactive", () => {
    const { container } = render(surface(false));
    const wrapper = container.querySelector<HTMLElement>(".editor-area-scroll");
    expect(wrapper?.style.display).toBe("none");
    expect(wrapper?.hasAttribute("data-editor-active")).toBe(false);
  });

  it("carries the pdf-preview-scroll class the old branch had", () => {
    const { container } = render(surface(true));
    expect(container.querySelector(".editor-area-scroll")?.className).toContain(
      "pdf-preview-scroll",
    );
  });

  it("derives path and refreshKey from its OWN tab, not the active tab", () => {
    // §288 규칙 2 — 숨은 PDF가 활성 탭의 mtime을 refreshKey로 받으면 엉뚱하게 리로드한다.
    // 먼저 활성으로 마운트한 뒤 다른 탭으로 옮긴다 — 한 번도 활성이 아니었던 표면은
    // 애초에 마운트되지 않는다(유지의 정의).
    const { container, rerender } = render(surface(true));
    useEditorStore.setState({ activeTabId: "m1" });
    rerender(surface(false));
    const el = container.querySelector<HTMLElement>("[data-pdf]");
    expect(el?.dataset.pdf).toBe("p1");
    expect(el?.dataset.pdfPath).toBe("/v/1.pdf");
    // 999가 나오면 활성 탭(note.md)의 mtime을 집은 것이다.
    expect(el?.dataset.pdfRefresh).toBe("111");
  });
});
