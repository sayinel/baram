// §276.4/§276.5 BlockReferenceView — an AREA highlight ref renders the cropped
// PDF region, a TEXT highlight ref renders the full original sentence, and
// everything else (including every non-ready state) keeps the `display` chip.
//
// The crop itself is not exercised here: it needs a real canvas, which jsdom
// does not have. usePdfHighlightRefPreview is mocked so this file pins the only
// thing the NodeView actually decides — which branch renders, and whether
// Cmd+Click still navigates once an <img> is in the way.
//
// React NodeViews only mount through an <EditorContent> portals host, and
// @tiptap/react ≥3.28 mounts that portal on the tick AFTER the transaction —
// hence the flush() before every assertion (see wikilink-view.test.tsx).
import type { HighlightRefPreview } from "../../../components/editor/pdf/use-pdf-highlight-ref-preview";
import type { Mock } from "vitest";

import { act, fireEvent, render } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { preview, usePdfHighlightRefPreview } = vi.hoisted(() => {
  const preview = {
    current: {
      height: 0,
      kind: "none",
      src: null,
      status: "idle",
      text: null,
      width: 0,
    } as HighlightRefPreview,
  };
  return { preview, usePdfHighlightRefPreview: vi.fn(() => preview.current) };
});
vi.mock("../../../components/editor/pdf/use-pdf-highlight-ref-preview", () => ({
  usePdfHighlightRefPreview,
}));

import { createBaramExtensions } from "../../index";

const TARGET = "highlights/papers/Attention";
const BLOCK_ID = "abc123";
const DISPLAY = "영역 하이라이트 (1페이지)";
const SRC = "data:image/png;base64,AAAA";

/** §275.3이 `( )`를 지우고 80자에서 자르기 전의 원문. */
const FULL_TEXT =
  "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks (CNNs).";

const IDLE: HighlightRefPreview = {
  height: 0,
  kind: "none",
  src: null,
  status: "idle",
  text: null,
  width: 0,
};

const READY: HighlightRefPreview = {
  height: 90,
  kind: "area",
  src: SRC,
  status: "ready",
  text: null,
  width: 320,
};

const READY_TEXT: HighlightRefPreview = {
  height: 0,
  kind: "text",
  src: null,
  status: "ready",
  text: FULL_TEXT,
  width: 0,
};

describe("BlockReferenceView: highlight ref preview", () => {
  let editor: Editor;
  let onNavigate: Mock<(target: string, blockId: string) => void>;

  beforeEach(() => {
    onNavigate = vi.fn();
    preview.current = IDLE;
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

  it("sizes the image with width/height ATTRIBUTES, never inline style", async () => {
    // ‼️ The distinction is load-bearing, not stylistic. An inline `style`
    // declaration outranks `.block-reference-area-image { height: auto }`
    // (links.css), so a preview wider than the editor column would keep its
    // pinned pixel height while the width shrank — a squashed image. As
    // attributes they only supply the intrinsic ratio, which `max-width:
    // 100%` + `height: auto` can then scale freely.
    preview.current = READY;
    const el = await mount();

    const img = el.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("width")).toBe("320");
    expect(img.getAttribute("height")).toBe("90");
    expect(img.style.width).toBe("");
    expect(img.style.height).toBe("");
  });

  it.each([
    ["idle", IDLE],
    ["loading", { ...IDLE, status: "loading" as const }],
    ["unavailable", { ...IDLE, status: "unavailable" as const }],
    // A src/text that arrived without "ready" must not be trusted either —
    // the NodeView keys off the status, not off the payload being non-null.
    [
      "unavailable with a stale src",
      { ...READY, status: "unavailable" as const },
    ],
    [
      "unavailable with stale text",
      { ...READY_TEXT, status: "unavailable" as const },
    ],
  ])(
    "keeps the display chip while the preview is %s",
    async (_label, state) => {
      preview.current = state;
      const el = await mount();

      expect(el.querySelector("img")).toBeNull();
      expect(el.textContent).toBe(DISPLAY);
      expect(el.hasAttribute("data-area-preview")).toBe(false);
    },
  );

  it("renders the full original text once a TEXT preview is ready", async () => {
    // ‼️ 이 기능의 전부: 마크다운의 display는 여전히 80자로 잘린 라벨이지만
    // (§275.3 buildRefDisplay), 화면에는 동반 노트의 원문이 그려진다.
    preview.current = READY_TEXT;
    const el = await mount();

    expect(el.textContent).toBe(FULL_TEXT);
    expect(el.textContent).not.toBe(DISPLAY);
    expect(el.querySelector("img")).toBeNull();
  });

  it("keeps the chip frame for a text preview (no data-area-preview)", async () => {
    // data-area-preview는 links.css에서 칩의 배경/테두리/패딩을 꺼 버린다 —
    // 그림에는 맞지만 글자에는 아니다. 텍스트 분기는 여전히 칩이다.
    preview.current = READY_TEXT;
    const el = await mount();

    expect(el.hasAttribute("data-area-preview")).toBe(false);
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["whitespace only", "   \t "],
  ])(
    "falls back to the display label when a ready text preview is %s",
    async (_label, stored) => {
      // ‼️ 훅이 공백 판정을 통과시켜 버린 경우의 두 번째 방어선. null만
      // 검사하면(`fullText ?? text`) 공백 문자열은 그대로 그려져 클릭할 글자조차
      // 없는 빈 칩이 된다 — 이 파일이 이름으로 약속하는 바로 그 실패다.
      preview.current = { ...READY_TEXT, text: stored };
      const el = await mount();

      expect(el.textContent).toBe(DISPLAY);
    },
  );

  it("navigates on Cmd+Click from the TEXT branch too", async () => {
    preview.current = READY_TEXT;
    const el = await mount();

    fireEvent.click(el, { metaKey: true });

    expect(onNavigate).toHaveBeenCalledWith(TARGET, BLOCK_ID);
  });

  it("navigates on Cmd+Click from the plain display chip too", async () => {
    // 세 분기 모두에서 참조는 링크로 남아야 한다.
    const el = await mount();

    fireEvent.click(el, { metaKey: true });

    expect(onNavigate).toHaveBeenCalledWith(TARGET, BLOCK_ID);
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
