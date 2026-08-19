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
    scrollOffsets: { current: new Map<string, number>() },
    setSourceBuffer: vi.fn(),
    sourceCursorOffsetFor: () => 0,
  }),
  code: () => null,
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

describe("every kind hides the same way", () => {
  // ‼️ 한때 HTML만 `visibility: hidden` + 절대 배치로 예외를 뒀다. iframe의 세로 스크롤이
  // opaque-origin 문서 안에 있으니 박스를 파기하지 말자는 생각이었는데, 실앱에서 반박됐다 —
  // 위치도 여전히 잃었고 화면도 여전히 하얗게 남았다. 그 위치는 이제 §291 bridge가 프레임과
  // 주고받으므로(html-preview-shim.js) 예외를 둘 이유가 없어졌다.
  //
  // 이 테스트는 그 예외가 조용히 되살아나지 않게 한다. 되살리려면 그때는 **증거**가 있어야 한다.
  it.each<RetainedKind>(["pdf", "code", "plugin", "html"])(
    "%s hides with display:none and stays in flow",
    (kind) => {
      const el = wrapperFor(kind, false);
      expect(el.style.display).toBe("none");
      expect(el.style.position).toBe("");
      expect(el.style.visibility).toBe("");
    },
  );

  it.each<RetainedKind>(["pdf", "code", "plugin", "html"])(
    "%s is visible when active",
    (kind) => {
      const el = wrapperFor(kind, true);
      expect(el.style.display).toBe("");
    },
  );
});
