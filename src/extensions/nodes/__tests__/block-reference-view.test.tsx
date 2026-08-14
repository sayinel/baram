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

  async function mount(
    extraAttrs: Record<string, unknown> = {},
  ): Promise<HTMLElement> {
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
                attrs: {
                  blockId: BLOCK_ID,
                  display: DISPLAY,
                  target: TARGET,
                  ...extraAttrs,
                },
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

describe("BlockReferenceView: §276.6 per-reference width", () => {
  let editor: Editor;

  beforeEach(() => {
    preview.current = IDLE;
  });

  afterEach(() => {
    editor.destroy();
    vi.clearAllMocks();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  async function mount(
    extraAttrs: Record<string, unknown> = {},
  ): Promise<HTMLElement> {
    editor = new Editor({
      content: "<p>seed</p>",
      extensions: createBaramExtensions({ onNavigateBlockRef: vi.fn() }),
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
                attrs: {
                  blockId: BLOCK_ID,
                  display: DISPLAY,
                  target: TARGET,
                  ...extraAttrs,
                },
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

  /** The same reference, but inside a one-cell table. */
  async function mountInTableCell(): Promise<HTMLElement> {
    editor = new Editor({
      content: "<p>seed</p>",
      extensions: createBaramExtensions({ onNavigateBlockRef: vi.fn() }),
    });
    render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "table",
            content: [
              {
                type: "tableRow",
                content: [
                  {
                    type: "tableCell",
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          {
                            attrs: {
                              blockId: BLOCK_ID,
                              display: DISPLAY,
                              target: TARGET,
                            },
                            type: "blockReference",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    });
    await flush();
    return editor.view.dom.querySelector(".block-reference") as HTMLElement;
  }

  it("renders a right-edge resize handle on a ready area preview", async () => {
    preview.current = READY;
    const el = await mount();

    expect(el.querySelectorAll(".media-resize-handle")).toHaveLength(1);
    expect(el.querySelector(".media-resize-handle-right")).not.toBeNull();
    // 왼쪽 가장자리는 문단의 글자에 고정되어 있다 — 왼쪽 핸들은 크기가 아니라
    // 위치를 옮기려 드는 것이라 애초에 붙이지 않는다.
    expect(el.querySelector(".media-resize-handle-left")).toBeNull();
  });

  it("does not render a resize handle on the TEXT branch", async () => {
    // ‼️ §276.6은 영역 참조 전용이다. 텍스트 참조에 핸들이 붙으면 드래그 한 번이
    // 그릴 그림도 없는 참조의 마크다운에 |w=NN을 적어 넣는다.
    preview.current = READY_TEXT;
    const el = await mount();

    expect(el.querySelector(".media-resize-handle")).toBeNull();
  });

  it.each([
    ["idle", IDLE],
    ["loading", { ...IDLE, status: "loading" as const }],
    ["unavailable", { ...IDLE, status: "unavailable" as const }],
    [
      "unavailable with a stale src",
      { ...READY, status: "unavailable" as const },
    ],
  ])(
    "does not render a resize handle while the preview is %s",
    async (_label, state) => {
      preview.current = state;
      const el = await mount();

      expect(el.querySelector(".media-resize-handle")).toBeNull();
    },
  );

  it("applies a stored width as a percentage on the wrapper", async () => {
    preview.current = READY;
    const el = await mount({ width: 60 });

    expect(el.style.width).toBe("60%");
    // links.css는 이 표시로만 크롭에 width:100%를 준다 — 없으면 래퍼만 넓어지고
    // 그림은 원래 크기 그대로 남는다.
    expect(el.getAttribute("data-sized")).toBe("true");
  });

  it("leaves an unsized reference at its natural size", async () => {
    preview.current = READY;
    const el = await mount();

    expect(el.style.width).toBe("");
    expect(el.hasAttribute("data-sized")).toBe(false);
  });

  it("ignores a width on the TEXT branch", async () => {
    // 텍스트 칩에 60%를 먹이면 문장이 잘린 칸에 갇힌다. 너비는 크롭이 실제로
    // 그려진 분기에서만 의미가 있다.
    preview.current = READY_TEXT;
    const el = await mount({ width: 60 });

    expect(el.style.width).toBe("");
    expect(el.hasAttribute("data-sized")).toBe(false);
  });

  it("does not offer the handle inside a table cell", async () => {
    // ‼️ 너비는 `|w=NN`으로 실린다. 이스케이프되지 않은 `|`는 GFM 셀을 쪼개므로
    // `| ((f#^id)) |`가 다음 저장/열기에서 두 칸이 되고 참조는 사라진다 —
    // 마우스 제스처 한 번이 표와 참조를 동시에 날린다. 표 안에서 안전하게
    // 왕복하던 것은 파이프 없는 참조뿐이고, 이 핸들이 그 첫 파이프를 넣는다.
    preview.current = READY;
    const el = await mountInTableCell();

    // 크롭 자체는 그대로 그려진다 — 막는 것은 리사이즈뿐이다.
    expect(el.querySelector("img")).not.toBeNull();
    expect(el.querySelector(".media-resize-handle")).toBeNull();
  });
});

describe("BlockReferenceView: §276.6 drag against the real editor DOM", () => {
  // ‼️ 이 describe가 CRITICAL-1의 회귀 테스트다. 훅의 손수 만든 하네스는
  // `<div><span ref>` 모양이라 요소의 부모가 곧 문단이지만, @tiptap/react는
  // 모든 React NodeView를 `span.react-renderer`로 한 겹 감싼다. 그 span에는
  // CSS 규칙이 없어 display:inline이고, 따라서 폭이 자기 inline-block 자식 —
  // 즉 리사이즈 중인 크롭 자신 — 과 같다. `parentElement`를 재면 드래그가
  // 자기 참조가 되고, 크롭의 비율을 문단의 비율인 양 커밋한다.
  let editor: Editor;

  beforeEach(() => {
    preview.current = READY;
  });

  afterEach(() => {
    editor.destroy();
    vi.clearAllMocks();
  });

  async function flush(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  function stubRect(el: HTMLElement, left: number, width: number) {
    el.getBoundingClientRect = () =>
      ({
        bottom: 40,
        height: 40,
        left,
        right: left + width,
        toJSON: () => ({}),
        top: 0,
        width,
        x: left,
        y: 0,
      }) as DOMRect;
  }

  function storedWidth(): unknown {
    let found: unknown = "NO REFERENCE IN DOC";
    editor.state.doc.descendants((n) => {
      if (n.type.name === "blockReference") found = n.attrs.width;
    });
    return found;
  }

  /**
   * Mount a reference mid-paragraph and give the real ancestors boxes:
   * paragraph 1000px wide at x=0, the reference a 320px crop starting at x=200,
   * and the react-renderer wrapper the same box as the reference (which is what
   * it really is — an inline box around one inline-block).
   */
  async function mountAndMeasure(): Promise<{
    el: HTMLElement;
    handle: HTMLElement;
    para: HTMLElement;
    renderer: HTMLElement;
  }> {
    editor = new Editor({
      content: "<p>seed</p>",
      extensions: createBaramExtensions({ onNavigateBlockRef: vi.fn() }),
    });
    render(<EditorContent editor={editor} />);
    act(() => {
      editor.commands.setContent({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { text: "words before ", type: "text" },
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

    const el = editor.view.dom.querySelector(".block-reference") as HTMLElement;
    const renderer = el.parentElement as HTMLElement;
    const para = renderer.parentElement as HTMLElement;
    stubRect(para, 0, 1000);
    stubRect(renderer, 200, 320);
    stubRect(el, 200, 320);
    return {
      el,
      handle: el.querySelector(".media-resize-handle") as HTMLElement,
      para,
      renderer,
    };
  }

  it("is wrapped by span.react-renderer inside the paragraph", async () => {
    // 이 단정이 무너지면 아래 두 테스트는 조용히 무의미해진다 — 위 하네스가
    // 그랬듯이. @tiptap/react의 래핑을 여기 못박아 둔다.
    const { para, renderer } = await mountAndMeasure();

    expect(renderer.tagName).toBe("SPAN");
    expect(renderer.className).toContain("react-renderer");
    expect(para.tagName).toBe("P");
  });

  it("commits a width measured against the PARAGRAPH, not the wrapper", async () => {
    const { el, handle } = await mountAndMeasure();
    expect(storedWidth()).toBeNull();

    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(document, { clientX: 500 });

    // 커서는 참조의 왼쪽 끝(200)에서 300px 오른쪽 — 1000px 문단의 30%.
    // react-renderer(320px)를 재면 94%가 나온다.
    expect(el.querySelector(".media-resize-label")?.textContent).toBe("30%");

    fireEvent.mouseUp(document);
    expect(storedWidth()).toBe(30);
  });

  it("keeps the handle painted for the duration of the drag", async () => {
    // 인라인 크롭은 작아서 왼쪽이나 아래로 끌면 hover가 떨어진다 — :hover만으로
    // 켜면 사용자가 잡고 있는 그립이 제스처 도중 사라진다.
    const { el, handle } = await mountAndMeasure();
    expect(el.classList.contains("is-resizing")).toBe(false);

    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(document, { clientX: 500 });
    expect(el.classList.contains("is-resizing")).toBe(true);

    fireEvent.mouseUp(document);
    expect(el.classList.contains("is-resizing")).toBe(false);
  });

  it("commits nothing when the pointer never moved", async () => {
    const { handle } = await mountAndMeasure();

    fireEvent.mouseDown(handle);
    fireEvent.mouseUp(document);

    expect(storedWidth()).toBeNull();
  });
});
