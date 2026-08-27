// §312 코드 표면 배선 — 스냅샷과 접근자는 **다른 시점**을 본다.
//
// ‼️ 이 둘이 같은 값을 보면 §312의 경합 방어가 통째로 무의미해진다. `content`는 렌더가
// 버퍼를 읽은 순간에 굳고, `getLatestContent`는 불릴 때마다 지금의 버퍼를 본다. 배선이
// 실수로 `getLatestContent={() => content}` 같은 모양이 되면 SourceCodeEditor 안의 관문은
// 그대로 초록인 채 낡은 스냅샷을 뷰에 밀어 넣는다.
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// 리프 컴포넌트만 대체한다 — 검사 대상인 `code` 렌더러는 진짜를 쓴다.
vi.mock("../SourceCodeEditor", () => ({
  SourceCodeEditor: (props: {
    content: string;
    getLatestContent?: () => string;
  }) => {
    captured = props;
    return <div data-testid="code-surface" />;
  },
}));

import type { SourceCodeEditorRef } from "../SourceCodeEditor";
import type { TabSurfaceContext } from "../tab-surface-renderers";

import { createTabSurfaceRenderers } from "../tab-surface-renderers";

let captured: null | { content: string; getLatestContent?: () => string } =
  null;

const buffers: Record<string, string> = { a: "- [ ] alpha\n" };

const renderers = createTabSurfaceRenderers({
  codeLanguageFor: () => undefined,
  getSourceBuffer: (id) => buffers[id] ?? "",
  hasSourceBuffer: (id) => id in buffers,
  markDirty: vi.fn(),
  onPdfFindApiChange: vi.fn(),
  onTogglePdfFind: vi.fn(),
  pdfFindOpen: false,
  pluginIdFor: () => "",
  scrollOffsets: { current: new Map<string, number>() },
  setSourceBuffer: vi.fn(),
  sourceCursorOffsetFor: () => 0,
});

const ctx: TabSurfaceContext = {
  active: true,
  codeEditorRef: { current: null as null | SourceCodeEditorRef },
  filePath: "/v/a.md",
  refreshKey: 0,
  tabId: "a",
};

describe("code surface wiring", () => {
  it("hands the surface a live accessor, not a second copy of the snapshot", () => {
    render(<>{renderers.code(ctx)}</>);
    expect(captured?.content).toBe("- [ ] alpha\n");

    // §305 태스크 쓰기가 버퍼를 고친다. 아직 리렌더는 없다.
    buffers.a = "- [x] alpha\n";

    expect(captured?.content).toBe("- [ ] alpha\n");
    expect(captured?.getLatestContent?.()).toBe("- [x] alpha\n");
  });

  it("reads the accessor from the surface's OWN tab", () => {
    buffers.b = "- [ ] beta\n";
    render(<>{renderers.code({ ...ctx, filePath: "/v/b.md", tabId: "b" })}</>);
    expect(captured?.getLatestContent?.()).toBe("- [ ] beta\n");
  });
});
