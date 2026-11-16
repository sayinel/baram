// §396 Mermaid · SVG 전체 화면 보기 모달이 줌 주인이 되는지, 그리고 `ensureSvgViewBox` 가 보기
// 모달에만 걸리는지. 줌 입력 경로는 `use-zoom.ts` 의 공개 `zoomIn()` — 키 경로와 같은 분기다.
import { act, cleanup, render, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

import { zoomIn } from "../../../../hooks/use-zoom";
import { useSettingsStore } from "../../../../stores/settings/store";
import { topZoomOwner } from "../../../../utils/viewer-zoom";
import { createBaramExtensions } from "../../../index";
import { MermaidViewFullscreenModal } from "../MermaidFullscreenModals";
import { SvgViewFullscreenModal } from "../SvgFullscreenModals";

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
const SIZE_ONLY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="10" height="10"/></svg>';

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  for (const e of editors.splice(0)) e.destroy();
});

beforeEach(() => {
  useSettingsStore.setState({ zoomLevel: 1 });
});

const KINDS = {
  mermaid: {
    closeClass: ".mermaid-fullscreen-close",
    render: () =>
      render(
        <MermaidViewFullscreenModal
          detectedType="flowchart"
          error={null}
          onClose={() => undefined}
          svgHtml={SVG}
        />,
      ),
    zoomClass: ".mermaid-fullscreen-zoom",
  },
  svg: {
    closeClass: ".svg-fullscreen-close",
    render: () =>
      render(
        <SvgViewFullscreenModal onClose={() => undefined} svgHtml={SVG} />,
      ),
    zoomClass: ".svg-fullscreen-zoom",
  },
} as const;

describe.each(["mermaid", "svg"] as const)("%s view modal", (kind) => {
  const k = KINDS[kind];

  it("is the zoom owner while open", () => {
    expect(topZoomOwner()).toBeNull();
    k.render();
    expect(topZoomOwner()).not.toBeNull();
  });

  it("zoomIn() routes here: label 125%, editor zoom unchanged", () => {
    k.render();
    expect(screen.getByText("100%")).toBeTruthy();
    act(() => zoomIn());
    expect(screen.getByText("125%")).toBeTruthy();
    expect(useSettingsStore.getState().zoomLevel).toBe(1);
  });

  it("unmount leaves editor zoom untouched and removes the owner", () => {
    const view = k.render();
    act(() => zoomIn());
    view.unmount();
    expect(topZoomOwner()).toBeNull();
    expect(useSettingsStore.getState().zoomLevel).toBe(1);
    // With the owner gone the same call reaches the editor again.
    act(() => zoomIn());
    expect(useSettingsStore.getState().zoomLevel).not.toBe(1);
  });

  it("the header controls sit before the close button", () => {
    k.render();
    const zoom = document.body.querySelector(k.zoomClass);
    const close = document.body.querySelector(k.closeClass);
    if (!zoom || !close) throw new Error("zoom group or close button missing");
    expect(zoom.parentElement).toBe(close.parentElement);
    expect(
      zoom.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(zoom.querySelectorAll("button")).toHaveLength(3);
  });
});

describe("svg view modal viewBox", () => {
  it("renders a viewBox for a size-only svg", () => {
    render(
      <SvgViewFullscreenModal onClose={() => undefined} svgHtml={SIZE_ONLY} />,
    );
    const svg = document.body.querySelector(".svg-block-render svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 200 100");
    expect(svg?.getAttribute("width")).toBe("200");
  });

  it("the inline block keeps a size-only svg as written (pair)", async () => {
    const editor = new Editor({ extensions: createBaramExtensions() });
    editors.push(editor);
    const view = render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent({
        content: [
          { attrs: { code: SIZE_ONLY }, type: "svgBlock" },
          { type: "paragraph" },
        ],
        type: "doc",
      });
    });
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
    const svg = view.container.querySelector(".svg-block-render svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("200");
    expect(svg?.hasAttribute("viewBox")).toBe(false);
  });
});
