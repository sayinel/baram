// §296 · §299 VideoView — 오류 카드와 임베드 지연 마운트.
//
// ‼️ jsdom은 재생을 못 한다. 그래서 재생 자체가 아니라 **관측 가능한 계약**만 단정한다:
// error 이벤트 뒤에 오류 문구가 나오는가, 클릭 전에 iframe이 없는가.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
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
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <div className={className}>{children}</div>,
}));

import { VideoView } from "../nodes/video-view";

type Attrs = Record<string, unknown>;

function renderVideo(attrs: Attrs) {
  const props = {
    node: { attrs: { widthPercent: 100, ...attrs } },
    updateAttributes: vi.fn(),
    selected: false,
    editor: {} as never,
    getPos: () => 0,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<VideoView {...(props as any)} />);
}

describe("VideoView (§296)", () => {
  it("renders a poster video element for a local file, not controls", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    const el = container.querySelector("video");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("preload")).toBe("metadata");
    expect(el!.hasAttribute("controls")).toBe(false);
    expect(el!.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/assets/clip.mp4#t=0.1",
    );
  });

  it("attaches controls after the play button is clicked", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    fireEvent.click(container.querySelector(".video-play-button")!);
    expect(container.querySelector("video")!.hasAttribute("controls")).toBe(
      true,
    );
  });

  // §17.2-8 문서를 여는 순간 provider에 요청이 가지 않는다.
  it("does not mount an embed iframe before the user clicks", () => {
    const { container } = renderVideo({ src: "https://youtu.be/abc123" });
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector(".video-embed-card")).not.toBeNull();
  });

  it("mounts the constructed nocookie iframe on click", () => {
    const { container } = renderVideo({ src: "https://youtu.be/abc123" });
    fireEvent.click(container.querySelector(".video-play-button")!);
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("src")).toBe(
      "https://www.youtube-nocookie.com/embed/abc123",
    );
    expect(iframe!.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("shows the error card after a media error", () => {
    const { container } = renderVideo({ src: "missing.mp4" });
    fireEvent.error(container.querySelector("video")!);
    expect(screen.getByText(/missing\.mp4/)).toBeInTheDocument();
    expect(container.querySelector(".video-error")).not.toBeNull();
  });

  it("never resizes an embed (§17.2-6)", () => {
    const { container } = renderVideo({
      src: "https://youtu.be/abc123",
      widthPercent: 50,
    });
    expect(container.querySelectorAll(".media-resize-handle").length).toBe(0);
  });
});

// §296.1 클릭 가드 회귀 — 재생 버튼과 재생 중 네이티브 컨트롤은 mousedown이
// ProseMirror까지 닿기 전에 삼켜져야 한다.
//
// ProseMirror의 모든 클릭/선택 처리는 `mousedown` 리스너 하나에서 시작한다
// (prosemirror-view의 `handlers.mousedown`이 곧 singleClick 판정과
// `handleClick` prop 호출까지 다 몬다 — 별도의 "click" 리스너가 없다). 그래서
// `container`(NodeView를 감싸는, 실제 앱의 view.dom과 같은 자리)에 mousedown
// 리스너를 달아 두고 그게 불려지지 않는지만 보면 "PM이 이 클릭을 아예 못 봤다"를
// 정확히 증명한다 — video-play-button의 React onClick은 별개의 이벤트라 이
// 가드와 무관하게 계속 동작해야 한다(위 "attaches controls" 테스트가 그걸 잡는다).
//
// MediaToolbar.tsx(§295)와 같은 메커니즘: React의 `onMouseDown` prop은 React가
// 루트에서 재구현하는 합성 디스패치라 실제 mousedown이 view.dom을 이미 통과한
// "뒤"에 실행된다 — 그래서 반드시 ref로 붙인 네이티브 리스너여야 한다.
describe("VideoView click-guard regression (§296.1)", () => {
  it("swallows mousedown on the play button before it reaches an ancestor (PM's view.dom)", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    const ancestorMouseDown = vi.fn();
    container.addEventListener("mousedown", ancestorMouseDown);

    fireEvent.mouseDown(container.querySelector(".video-play-button")!);

    expect(ancestorMouseDown).not.toHaveBeenCalled();
  });

  it("still plays on click even though mousedown was swallowed", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    // A real pointer interaction is mousedown → mouseup → click; drive all
    // three so this fails the same way a removed swallow-ref would in the
    // browser (a plain fireEvent.click alone doesn't touch mousedown at all).
    const button = container.querySelector(".video-play-button")!;
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);

    expect(container.querySelector("video")!.hasAttribute("controls")).toBe(
      true,
    );
  });

  it("does NOT swallow mousedown on the poster before playing — it must still select the node like an image", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    const ancestorMouseDown = vi.fn();
    container.addEventListener("mousedown", ancestorMouseDown);

    fireEvent.mouseDown(container.querySelector("video")!);

    expect(ancestorMouseDown).toHaveBeenCalledTimes(1);
  });

  it("swallows mousedown on the native controls once playing, so scrubbing doesn't reach PM", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    fireEvent.click(container.querySelector(".video-play-button")!);
    expect(container.querySelector("video")!.hasAttribute("controls")).toBe(
      true,
    );

    const ancestorMouseDown = vi.fn();
    container.addEventListener("mousedown", ancestorMouseDown);
    fireEvent.mouseDown(container.querySelector("video")!);

    expect(ancestorMouseDown).not.toHaveBeenCalled();
  });

  it("does not swallow mousedown on the wrapper/figure margin — node selection must keep working", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    const ancestorMouseDown = vi.fn();
    container.addEventListener("mousedown", ancestorMouseDown);

    fireEvent.mouseDown(container.querySelector(".video-node-view")!);
    fireEvent.mouseDown(container.querySelector(".video-figure")!);

    expect(ancestorMouseDown).toHaveBeenCalledTimes(2);
  });
});
