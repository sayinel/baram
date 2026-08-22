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
  // §296 UX1: the poster → click-to-reveal-controls two-step is gone — a
  // local/remote file gets real native controls from the start (Logseq-style),
  // matching what the user actually asked for and removing a step that read
  // as a fake button turning into a real one.
  it("renders a video element with native controls from the start, for a local file", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    const el = container.querySelector("video");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("preload")).toBe("metadata");
    expect(el!.hasAttribute("controls")).toBe(true);
    expect(el!.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/assets/clip.mp4#t=0.1",
    );
  });

  it("renders no play button at all — there is nothing left to click before controls appear", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    expect(container.querySelector(".video-play-button")).toBeNull();
  });

  // §17.2-8 문서를 여는 순간 provider에 요청이 가지 않는다. This is the ONE
  // media shape that keeps a click-to-load step — a privacy decision
  // (youtube-nocookie was chosen so opening a document sends nothing to the
  // provider), not a UI one, so it is deliberately NOT unified with the file
  // branch above.
  it("does not mount an embed iframe before the user clicks", () => {
    const { container } = renderVideo({ src: "https://youtu.be/abc123" });
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector(".video-embed-card")).not.toBeNull();
  });

  it("mounts the constructed nocookie iframe when the embed card is clicked", () => {
    const { container } = renderVideo({ src: "https://youtu.be/abc123" });
    fireEvent.click(container.querySelector(".video-embed-card")!);
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

// §296 fix (deferred-minor #10): a single data-drag-handle on the figure
// covers all four render shapes — video, playing embed iframe, unplayed
// embed card, and error card (tiptap-core's onDragStart checks
// event.target.closest("[data-drag-handle]"), which a sibling never
// satisfies).
describe("VideoView drag handle covers every render shape (§296 deferred-minor #10)", () => {
  it("puts data-drag-handle on the figure, not (only) the video element", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    expect(
      container
        .querySelector(".video-figure")!
        .hasAttribute("data-drag-handle"),
    ).toBe(true);
  });

  it("covers the video shape (figure ancestor, no separate attr needed on <video>)", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
    const video = container.querySelector("video")!;
    expect(video.closest("[data-drag-handle]")).not.toBeNull();
  });

  it("covers the unplayed embed card", () => {
    const { container } = renderVideo({ src: "https://youtu.be/abc123" });
    const card = container.querySelector(".video-embed-card")!;
    expect(card.closest("[data-drag-handle]")).not.toBeNull();
  });

  it("covers the playing embed iframe", () => {
    const { container } = renderVideo({ src: "https://youtu.be/abc123" });
    fireEvent.click(container.querySelector(".video-embed-card")!);
    const iframe = container.querySelector("iframe")!;
    expect(iframe.closest("[data-drag-handle]")).not.toBeNull();
  });

  it("covers the error card", () => {
    const { container } = renderVideo({ src: "missing.mp4" });
    fireEvent.error(container.querySelector("video")!);
    const errorCard = container.querySelector(".video-error")!;
    expect(errorCard.closest("[data-drag-handle]")).not.toBeNull();
  });

  // §296 UX1: the old play button carried this same preventDefault trick —
  // now the embed card is the only remaining click-to-load surface, so it
  // inherits the exemption.
  it("keeps the embed card exempt from starting a native drag (preventDefault on mousedown)", () => {
    const { container } = renderVideo({ src: "https://youtu.be/abc123" });
    const card = container.querySelector(".video-embed-card")!;
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    card.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

// §296 fix (deferred-minor #11): the embedded player's own fullscreen
// control was inert — `allow` had encrypted-media/picture-in-picture but not
// fullscreen, and the legacy allowFullScreen attribute was never set either.
describe("VideoView embed iframe allows fullscreen (§296 deferred-minor #11)", () => {
  it("includes the fullscreen token in allow, and the legacy allowfullscreen attribute", () => {
    const { container } = renderVideo({ src: "https://youtu.be/abc123" });
    fireEvent.click(container.querySelector(".video-embed-card")!);
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("allow")).toContain("fullscreen");
    expect(iframe.hasAttribute("allowfullscreen")).toBe(true);
  });
});

// §296 fix (deferred-minor #12): the embed card/hint used to show the HOST
// WE CONSTRUCT (www.youtube-nocookie.com / player.vimeo.com) rather than the
// one the user actually typed — accurate about the request target, useless
// for recognising what they pasted.
describe("VideoView shows the original host, not the constructed one (§296 deferred-minor #12)", () => {
  it("shows youtu.be, not www.youtube-nocookie.com, for a youtu.be link", () => {
    const { container } = renderVideo({ src: "https://youtu.be/abc123" });
    const host = container.querySelector(".video-embed-host")!;
    expect(host.textContent).toBe("youtu.be");
    expect(host.textContent).not.toContain("youtube-nocookie");
  });

  it("shows the typed www.youtube.com host, not youtube-nocookie, for a /watch link", () => {
    const { container } = renderVideo({
      src: "https://www.youtube.com/watch?v=abc123",
    });
    const host = container.querySelector(".video-embed-host")!;
    expect(host.textContent).toBe("www.youtube.com");
  });

  it("shows vimeo.com, not player.vimeo.com, for a vimeo link", () => {
    const { container } = renderVideo({ src: "https://vimeo.com/123456789" });
    const host = container.querySelector(".video-embed-host")!;
    expect(host.textContent).toBe("vimeo.com");
  });
});

// §294 fix (M2): a playing embed needs its own data-video-src so export can
// find the original URL even after the card (which carried it before) is
// gone from the DOM, replaced by the iframe.
describe("VideoView embed iframe carries data-video-src for export (§294 M2)", () => {
  it("puts the original src on the iframe once loaded, not just the card", () => {
    const { container } = renderVideo({ src: "https://youtu.be/abc123" });
    fireEvent.click(container.querySelector(".video-embed-card")!);
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("data-video-src")).toBe(
      "https://youtu.be/abc123",
    );
  });
});

// §296.1 클릭 가드 회귀 — 네이티브 컨트롤(항상 켜짐, §296 UX1)의 mousedown이
// ProseMirror까지 닿기 전에 삼켜져야 한다.
//
// ProseMirror의 모든 클릭/선택 처리는 `mousedown` 리스너 하나에서 시작한다
// (prosemirror-view의 `handlers.mousedown`이 곧 singleClick 판정과
// `handleClick` prop 호출까지 다 몬다 — 별도의 "click" 리스너가 없다). 그래서
// `container`(NodeView를 감싸는, 실제 앱의 view.dom과 같은 자리)에 mousedown
// 리스너를 달아 두고 그게 불려지지 않는지만 보면 "PM이 이 클릭을 아예 못 봤다"를
// 정확히 증명한다.
describe("VideoView click-guard regression (§296.1)", () => {
  it("swallows mousedown on the video's native controls so scrubbing doesn't reach PM", () => {
    const { container } = renderVideo({ src: "assets/clip.mp4" });
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
