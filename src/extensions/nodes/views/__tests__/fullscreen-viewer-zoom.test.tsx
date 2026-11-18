// §396 Mermaid · SVG 전체 화면 모달(보기 · 편집)이 줌 주인이 되는지, 그리고 `ensureSvgViewBox` 가
// SVG 보기 모달과 SVG 편집 미리보기가 그리는 마크업에만 걸리고 본문 블록에는 걸리지 않는지. 확대 규칙의
// CSS 모양(mermaid.css · svg-block.css)도 읽어 고정한다. 줌 입력 경로는 `use-zoom.ts` 의 공개
// `zoomIn()` — 키 경로와 같은 분기다.
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(async () => undefined),
}));

import { useZoom, zoomIn } from "../../../../hooks/use-zoom";
import { useSettingsStore } from "../../../../stores/settings/store";
import { topZoomOwner } from "../../../../utils/viewer-zoom";
import { createBaramExtensions } from "../../../index";
import {
  MermaidEditFullscreenModal,
  MermaidViewFullscreenModal,
} from "../MermaidFullscreenModals";
import {
  SvgEditFullscreenModal,
  SvgViewFullscreenModal,
} from "../SvgFullscreenModals";

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

/** Header children in document order: label, then the zoom group, then every close/discard button. */
function expectHeaderOrder(
  labelClass: string,
  zoomClass: string,
  buttonClass: string,
): void {
  const zoom = document.body.querySelector(zoomClass);
  const label = document.body.querySelector(labelClass);
  const buttons = Array.from(document.body.querySelectorAll(buttonClass));
  if (!zoom || !label || buttons.length === 0) {
    throw new Error("label, zoom group or buttons missing");
  }
  expect(zoom.querySelectorAll("button")).toHaveLength(3);
  expect(label.parentElement).toBe(zoom.parentElement);
  expect(
    label.compareDocumentPosition(zoom) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  for (const b of buttons) {
    expect(b.parentElement).toBe(zoom.parentElement);
    expect(
      zoom.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
}

const KINDS = {
  mermaid: {
    closeClass: ".mermaid-fullscreen-close",
    labelClass: ".mermaid-block-label",
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
    labelClass: ".svg-block-label",
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

  it("the zoom group sits after the label and before the close button", () => {
    k.render();
    expectHeaderOrder(k.labelClass, k.zoomClass, k.closeClass);
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

const SVG_B =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><circle r="3"/></svg>';

function mermaidEdit(svg: string) {
  return (
    <MermaidEditFullscreenModal
      detectedType="flowchart"
      fullscreenCode="graph TD"
      fullscreenError={null}
      fullscreenSvg={svg}
      fullscreenTextareaRef={{ current: null }}
      onChangeCode={() => undefined}
      onClose={() => undefined}
      onDiscard={() => undefined}
    />
  );
}

function svgEdit(svg: string) {
  return (
    <SvgEditFullscreenModal
      fullscreenCode={svg}
      fullscreenSvg={svg}
      fullscreenTextareaRef={{ current: null }}
      onChangeCode={() => undefined}
      onClose={() => undefined}
      onDiscard={() => undefined}
    />
  );
}

const EDIT_KINDS = {
  mermaid: {
    buttonClass: ".mermaid-fullscreen-close",
    element: mermaidEdit,
    labelClass: ".mermaid-block-label",
    preview: ".mermaid-fullscreen-preview",
    textarea: ".mermaid-block-textarea",
    zoomClass: ".mermaid-fullscreen-zoom",
  },
  svg: {
    buttonClass: ".svg-fullscreen-close",
    element: svgEdit,
    labelClass: ".svg-block-label",
    preview: ".svg-fullscreen-preview",
    textarea: ".svg-block-textarea",
    zoomClass: ".svg-fullscreen-zoom",
  },
} as const;

describe.each(["mermaid", "svg"] as const)("%s edit modal", (kind) => {
  const k = EDIT_KINDS[kind];
  const realPlatform = navigator.platform;

  beforeEach(() => {
    // jsdom has no layout: the hook only writes its contract for an element with a width.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const w = this instanceof SVGSVGElement ? 200 : 800;
        const h = this instanceof SVGSVGElement ? 100 : 600;
        return new DOMRect(0, 0, w, h);
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: realPlatform,
    });
  });

  it("zoomIn() scales the preview only", () => {
    render(k.element(SVG));
    const preview = document.body.querySelector<HTMLElement>(k.preview);
    const textarea = document.body.querySelector<HTMLElement>(k.textarea);
    if (!preview || !textarea) throw new Error("preview or textarea missing");
    const textareaStyle = textarea.getAttribute("style");
    expect(preview.hasAttribute("data-viewer-zoomed")).toBe(false);
    act(() => zoomIn());
    expect(screen.getByText("125%")).toBeTruthy();
    expect(preview.hasAttribute("data-viewer-zoomed")).toBe(true);
    expect(preview.style.getPropertyValue("--viewer-zoom-width")).toBe("125px");
    expect(textarea.getAttribute("style")).toBe(textareaStyle);
    expect(textarea.hasAttribute("data-viewer-zoomed")).toBe(false);
    expect(textarea.closest("[data-viewer-zoomed]")).toBeNull();
    expect(useSettingsStore.getState().zoomLevel).toBe(1);
  });

  it("routes a key pressed in the textarea", () => {
    Object.defineProperty(navigator, "platform", {
      configurable: true,
      value: "MacIntel",
    });
    render(k.element(SVG));
    renderHook(() => useZoom(null));
    const textarea = document.body.querySelector(k.textarea);
    if (!textarea) throw new Error("textarea missing");
    fireEvent.keyDown(textarea, { key: "=", metaKey: true });
    expect(screen.getByText("125%")).toBeTruthy();
    expect(useSettingsStore.getState().zoomLevel).toBe(1);
  });

  it("keeps the scale across a re-render with different markup", () => {
    const view = render(k.element(SVG));
    act(() => zoomIn());
    const preview = document.body.querySelector<HTMLElement>(k.preview);
    if (!preview) throw new Error("preview missing");
    const before = preview.querySelector("svg");
    expect(preview.style.getPropertyValue("--viewer-zoom-width")).toBe("125px");
    view.rerender(k.element(SVG_B));
    const after = preview.querySelector("svg");
    expect(after).not.toBe(before);
    expect(after?.getAttribute("viewBox")).toBe("0 0 20 10");
    expect(screen.getByText("125%")).toBeTruthy();
    expect(preview.hasAttribute("data-viewer-zoomed")).toBe(true);
    expect(preview.style.getPropertyValue("--viewer-zoom-width")).toBe("250px");
  });

  it("the zoom group sits after the label and before the buttons", () => {
    render(k.element(SVG));
    expectHeaderOrder(k.labelClass, k.zoomClass, k.buttonClass);
    expect(document.body.querySelectorAll(k.buttonClass)).toHaveLength(2);
  });
});

describe("svg edit preview viewBox", () => {
  it("renders a viewBox for a size-only svg", () => {
    render(svgEdit(SIZE_ONLY));
    const svg = document.body.querySelector(
      ".svg-fullscreen-preview .svg-block-render svg",
    );
    expect(svg?.getAttribute("viewBox")).toBe("0 0 200 100");
    expect(svg?.getAttribute("width")).toBe("200");
  });
});

describe("zoomed rules scope to the root svg", () => {
  it.each([
    ["mermaid", "src/styles/editor/mermaid.css"],
    ["svg", "src/styles/editor/svg-block.css"],
  ])(
    "%s css has no descendant svg rule under [data-viewer-zoomed]",
    async (_k, path) => {
      const { readFileSync } = await import("node:fs");
      const css = readFileSync(path, "utf8");
      const selectors = Array.from(
        css.matchAll(/^([^{}/]*\[data-viewer-zoomed\][^{}]*)\{/gm),
      ).map((m) => m[1] ?? "");
      expect(selectors.length).toBeGreaterThan(0);
      const svgRules = selectors.filter((sel) => /(^|[\s>])svg\s*$/.test(sel));
      expect(svgRules.length).toBeGreaterThan(0);
      for (const sel of svgRules) expect(sel.trim()).toMatch(/> svg$/);
    },
  );
});

describe("zoomed mermaid edit preview stays top-aligned", () => {
  it("the wrapper takes cross-axis auto margins only and the pane keeps its alignment", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/styles/editor/mermaid.css", "utf8");
    const wrapper =
      /\.mermaid-fullscreen-preview\[data-viewer-zoomed\] \.mermaid-block-svg \{([^}]*)\}/.exec(
        css,
      );
    expect(wrapper?.[1]).toMatch(/margin:\s*0 auto;/);
    // The pane rule itself is gone: no zoomed-only align-items override on it.
    expect(css).not.toMatch(
      /\.mermaid-fullscreen-preview\[data-viewer-zoomed\]\s*\{/,
    );
  });
});
