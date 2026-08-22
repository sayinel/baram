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
