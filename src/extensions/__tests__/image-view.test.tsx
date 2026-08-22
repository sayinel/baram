// §294 I1 (image parity) — the width the figure actually draws, and what a
// resize drag commits.
//
// ‼️ These are the two shapes that caught the video version of this defect
// (see video-view.test.tsx). `widthPixel` was write-only there: parsed,
// serialized, pinned through expand/collapse — and never rendered, while a
// drag updated only `widthPercent` so the builder's pixel branch silently
// threw the drag away on save. The image node just gained the same attr, so it
// gets the same two guards rather than trusting the symmetry.
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
  invoke: vi.fn(),
}));

vi.mock("../../stores/editor/editor", () => ({
  useEditorStore: {
    getState: () => ({
      activeTabId: "t1",
      tabs: [{ id: "t1", filePath: "/vault/notes/today.md" }],
    }),
  },
}));

vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({
    children,
    className,
    ref,
  }: {
    children: React.ReactNode;
    className?: string;
    // The ref has to reach a real DOM node: useMediaResize measures
    // containerRef.current and startResize returns early when it is null, so a
    // dropped ref makes every drag assertion below vacuous.
    ref?: React.Ref<HTMLDivElement>;
  }) => (
    <div className={className} ref={ref}>
      {children}
    </div>
  ),
}));

import { ImageView } from "../nodes/image-view";

type Attrs = Record<string, unknown>;

function figureWidth(container: HTMLElement): string {
  return (container.querySelector(".image-figure") as HTMLElement).style.width;
}

function renderImage(attrs: Attrs, updateAttributes = vi.fn()) {
  const props = {
    // A remote src resolves synchronously in useImagePreview (no thumbnail
    // IPC), so the <img> and the figure exist on first render.
    node: { attrs: { widthPercent: 100, ...attrs } },
    updateAttributes,
    selected: false,
    editor: {} as never,
    getPos: () => 0,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<ImageView {...(props as any)} />);
}

/**
 * jsdom reports an all-zero rect for everything, and a zero container width
 * makes startResize bail before any drag state exists — the drag has to be
 * given a measurable container to be observable at all.
 */
function stubWrapperRect(container: HTMLElement): void {
  const wrapper = container.querySelector(".image-node-view") as HTMLElement;
  wrapper.getBoundingClientRect = () =>
    ({ left: 0, right: 1000, width: 1000 }) as DOMRect;
}

const SRC = "https://example.com/a.png";

describe("ImageView width rendering (§294 I1)", () => {
  it("draws a pixel width in px, not at 100%", () => {
    const { container } = renderImage({ src: SRC, widthPixel: 640 });
    expect(figureWidth(container)).toBe("640px");
  });

  it("draws a percentage when there is no pixel width", () => {
    const { container } = renderImage({ src: SRC, widthPercent: 60 });
    expect(figureWidth(container)).toBe("60%");
  });

  it("falls back to 100% when neither is set", () => {
    const { container } = renderImage({ src: SRC });
    expect(figureWidth(container)).toBe("100%");
  });

  it("a drag beats a pre-existing pixel width, live and on commit", () => {
    const updateAttributes = vi.fn();
    const { container } = renderImage(
      { src: SRC, widthPixel: 640 },
      updateAttributes,
    );
    stubWrapperRect(container);

    fireEvent.mouseDown(
      container.querySelector(".media-resize-handle-right")!,
      {
        clientX: 500,
      },
    );
    fireEvent.mouseMove(document, { clientX: 400 });

    // Live preview: the drag % is drawn, not the 640px still on the node.
    expect(figureWidth(container)).toBe("20%");

    fireEvent.mouseUp(document);

    expect(updateAttributes).toHaveBeenCalledTimes(1);
    // ‼️ toStrictEqual, not toHaveBeenCalledWith. The latter (and toEqual)
    // IGNORE a key whose value is undefined, so they cannot tell
    // `{widthPercent: 20}` from `{widthPercent: 20, widthPixel: undefined}` —
    // which is the entire difference this test exists to observe. Mutation
    // testing caught exactly that on the video side. The key must be PRESENT:
    // updateAttributes spreads over node.attrs, so a missing key leaves the
    // stale 640 while an explicit undefined resets it to the schema default.
    expect(updateAttributes.mock.calls[0][0]).toStrictEqual({
      widthPercent: 20,
      widthPixel: undefined,
    });
  });
});
