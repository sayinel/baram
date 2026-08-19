import type {
  RetainedEntry,
  RetainedKind,
} from "../../../hooks/use-retained-tabs";
import type { TabSurfaceRenderers } from "../tab-surface-renderers";

// §286/§291 — 숨기는 방식은 kind마다 다르다.
//
// ‼️ 실앱에서 드러난 결함: HTML 프리뷰는 돌아오면 문서 처음으로 가고, 스크롤하기 전까지
// 화면이 하얗게 남았다. 원인은 두 사실의 결합이다.
//
//   1. `.editor-area-scroll.html-preview-scroll`은 `overflow: auto hidden`이다 — 세로
//      스크롤은 래퍼가 아니라 **iframe 내부 문서**가 갖는다. opaque origin이라 우리가
//      읽거나 쓸 수 없으므로 §291의 기록·복원이 닿지 않는다.
//   2. `display: none`은 그 문서의 레이아웃 박스를 파기한다 — 위치와 페인트를 함께 잃는다.
//
// 저장할 수 없는 상태는 **잃지 않는 수밖에 없다.** 그래서 HTML 표면만 레이아웃에 남기고
// 시각적으로만 감춘다. 나머지 kind는 스크롤을 우리가 복원할 수 있으므로 display:none이
// 그대로 옳다(레이아웃 비용이 없다).
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorStore } from "../../../stores/editor/editor";
import { createTabSurfaceRenderers } from "../tab-surface-renderers";
import { TabSurface } from "../TabSurface";

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
    setSourceBuffer: vi.fn(),
    sourceCursorOffsetFor: () => 0,
  }),
  code: () => null,
  graph: () => null,
  html: () => null,
  pdf: () => null,
  plugin: () => null,
};

function wrapperFor(kind: RetainedKind, active: boolean) {
  const entry: RetainedEntry = { kind, tabId: "t" };
  const { container } = render(
    <TabSurface active={active} entry={entry} renderers={renderers} />,
  );
  const el = container.querySelector<HTMLElement>(".editor-area-scroll");
  if (!el) throw new Error("no wrapper");
  return el;
}

beforeEach(() => {
  useEditorStore.setState({
    activeTabId: "t",
    mruOrder: ["t"],
    tabs: [
      {
        contextId: "c",
        filePath: "/v/x.html",
        id: "t",
        isDirty: false,
        isPinned: false,
        title: "x",
      },
    ],
  });
});

describe("html surface stays in layout", () => {
  it("hides with visibility, never display:none", () => {
    const el = wrapperFor("html", false);
    expect(el.style.visibility).toBe("hidden");
    // display:none이면 iframe 문서의 레이아웃 박스가 파기되어 내부 스크롤과 페인트를 잃는다.
    expect(el.style.display).not.toBe("none");
  });

  it("is absolutely positioned so a laid-out hidden surface cannot disturb the flex flow", () => {
    const el = wrapperFor("html", false);
    expect(el.style.position).toBe("absolute");
  });

  it("is visible and positioned the same way when active", () => {
    const el = wrapperFor("html", true);
    expect(el.style.visibility).toBe("");
    expect(el.style.position).toBe("absolute");
  });
});

describe("other kinds keep display:none", () => {
  it.each<RetainedKind>(["pdf", "code", "graph", "plugin"])(
    "%s hides with display:none",
    (kind) => {
      // 이 표면들의 스크롤은 우리가 읽고 되돌릴 수 있으므로(§291), 레이아웃에서 빼는 편이
      // 싸다. 특히 마크다운·대용량 PDF를 숨은 채로 레이아웃에 남기면 리사이즈마다 비용이 든다.
      const el = wrapperFor(kind, false);
      expect(el.style.display).toBe("none");
      expect(el.style.position).toBe("");
    },
  );
});
