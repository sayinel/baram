// §276.4 BlockReferenceView — an AREA highlight ref renders the cropped PDF
// region; everything else (and every non-ready state) keeps the text chip.
//
// The crop itself is not exercised here: it needs a real canvas, which jsdom
// does not have. usePdfAreaRefPreview is mocked so this file pins the only
// thing the NodeView actually decides — which branch renders, and whether
// Cmd+Click still navigates once an <img> is in the way.
//
// React NodeViews only mount through an <EditorContent> portals host, and
// @tiptap/react ≥3.28 mounts that portal on the tick AFTER the transaction —
// hence the flush() before every assertion (see wikilink-view.test.tsx).
import type { AreaRefPreview } from "../../../components/editor/pdf/use-pdf-area-ref-preview";
import type { Mock } from "vitest";

import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { preview, usePdfAreaRefPreview } = vi.hoisted(() => {
  const preview = {
    current: {
      height: 0,
      src: null,
      status: "idle",
      width: 0,
    } as AreaRefPreview,
  };
  return { preview, usePdfAreaRefPreview: vi.fn(() => preview.current) };
});
vi.mock("../../../components/editor/pdf/use-pdf-area-ref-preview", () => ({
  usePdfAreaRefPreview,
}));

import { createBaramExtensions } from "../../index";

const TARGET = "highlights/papers/Attention";
const BLOCK_ID = "abc123";
const DISPLAY = "영역 하이라이트 (1페이지)";
const SRC = "data:image/png;base64,AAAA";

const READY: AreaRefPreview = {
  height: 90,
  src: SRC,
  status: "ready",
  width: 320,
};

describe("BlockReferenceView: area highlight preview", () => {
  let editor: Editor;
  let onNavigate: Mock<(target: string, blockId: string) => void>;

  beforeEach(() => {
    onNavigate = vi.fn();
    preview.current = { height: 0, src: null, status: "idle", width: 0 };
  });

  afterEach(() => {
    editor.destroy();
    vi.clearAllMocks();
  });

  /** Flush React passive effects + the deferred NodeView portal mount. */
  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  async function mount(): Promise<HTMLElement> {
    editor = new Editor({
      content: "<p>seed</p>",
      extensions: createBaramExtensions({ onNavigateBlockRef: onNavigate }),
    });
    render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                attrs: { blockId: BLOCK_ID, display: DISPLAY, target: TARGET },
                type: "blockReference",
              },
            ],
          },
        ],
      });
    });
    await flush();
    return editor.view.dom.querySelector(".block-reference") as HTMLElement;
  }

  it("renders the cropped image once the preview is ready", async () => {
    preview.current = READY;
    const el = await mount();

    const img = el.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe(SRC);
    expect(el.getAttribute("data-area-preview")).toBe("true");
    // The chip text is gone — the image replaces it, not accompanies it.
    expect(el.textContent).toBe("");
  });

  it("uses the display label as the image's alt text", async () => {
    preview.current = READY;
    const el = await mount();

    expect(el.querySelector("img")?.getAttribute("alt")).toBe(DISPLAY);
  });

  it("sizes the image from the preview's CSS dimensions", async () => {
    preview.current = READY;
    const el = await mount();

    const img = el.querySelector("img") as HTMLImageElement;
    expect(img.style.width).toBe("320px");
    expect(img.style.height).toBe("90px");
  });

  it.each([
    ["idle", { height: 0, src: null, status: "idle" as const, width: 0 }],
    ["loading", { height: 0, src: null, status: "loading" as const, width: 0 }],
    [
      "unavailable",
      { height: 0, src: null, status: "unavailable" as const, width: 0 },
    ],
    // A src that arrived without "ready" must not be trusted either — the
    // NodeView keys off the status, not off src being non-null.
    [
      "unavailable with a stale src",
      { height: 90, src: SRC, status: "unavailable" as const, width: 320 },
    ],
  ])("keeps the text chip while the preview is %s", async (_label, state) => {
    preview.current = state;
    const el = await mount();

    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe(DISPLAY);
    expect(el.hasAttribute("data-area-preview")).toBe(false);
  });

  it("still navigates on Cmd+Click when the image is what got clicked", async () => {
    // ‼️ The whole point of the feature is that the ref stays a link. The
    // click handler lives on the NodeViewWrapper, so the <img> must let the
    // event through — click the image itself, not the wrapper.
    preview.current = READY;
    const el = await mount();

    const img = el.querySelector("img") as HTMLImageElement;
    fireEvent.click(img, { metaKey: true });

    expect(onNavigate).toHaveBeenCalledWith(TARGET, BLOCK_ID);
  });

  it("navigates on Ctrl+Click too (the non-macOS modifier)", async () => {
    preview.current = READY;
    const el = await mount();

    fireEvent.click(el.querySelector("img") as HTMLImageElement, {
      ctrlKey: true,
    });

    expect(onNavigate).toHaveBeenCalledWith(TARGET, BLOCK_ID);
  });

  it("does not navigate on a plain click", async () => {
    preview.current = READY;
    const el = await mount();

    fireEvent.click(el.querySelector("img") as HTMLImageElement);

    expect(onNavigate).not.toHaveBeenCalled();
  });
});
