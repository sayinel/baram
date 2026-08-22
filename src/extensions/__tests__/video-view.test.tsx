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
    ref,
  }: {
    children: React.ReactNode;
    className?: string;
    // §294 I1: the ref has to reach a real DOM node. The first version of
    // this mock dropped it, which made every resize assertion vacuous —
    // useMediaResize measures containerRef.current and startResize returns
    // early when it is null, so the drag simply never happened.
    ref?: React.Ref<HTMLDivElement>;
  }) => (
    <div className={className} ref={ref}>
      {children}
    </div>
  ),
}));

// §296 fullscreen — jsdom has no real Fullscreen API, so the two functions
// this component actually calls are mocked; behavior is asserted against the
// mocks, not real browser fullscreen (see utils/fullscreen.test.ts for that).
const { isFullscreenSupported, requestVideoFullscreen } = vi.hoisted(() => ({
  isFullscreenSupported: vi.fn(() => true),
  requestVideoFullscreen: vi.fn(),
}));
vi.mock("../../utils/fullscreen", () => ({
  isFullscreenSupported,
  requestVideoFullscreen,
}));

import { VideoView } from "../nodes/video-view";

type Attrs = Record<string, unknown>;

function renderVideo(attrs: Attrs, updateAttributes = vi.fn()) {
  const props = {
    node: { attrs: { widthPercent: 100, ...attrs } },
    updateAttributes,
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

  // Security review Medium: a remote (non-local, non-data) video src used to
  // get preload="metadata" unconditionally, which fires a network request to
  // the src's host the moment the block renders — an open-tracking-pixel
  // vector (§297 §security-review). Local files keep "metadata" so their
  // duration/poster still populate; only genuinely remote sources are gated,
  // via isRemoteOrData (the same predicate resolveMediaSrc itself uses) —
  // NOT a fresh regex against the post-resolution src, which would wrongly
  // flag a local Windows asset URL (`http://asset.localhost/...`) as remote.
  it("sets preload=none for a remote https:// video, to avoid beaconing on open", () => {
    const { container } = renderVideo({
      src: "https://attacker.example/t.mp4",
    });
    const el = container.querySelector("video");
    expect(el).not.toBeNull();
    expect(el!.getAttribute("preload")).toBe("none");
    expect(el!.getAttribute("src")).toBe(
      "https://attacker.example/t.mp4#t=0.1",
    );
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

  // §297 fix (M-10, whole-branch review): `failed` used to stay true forever
  // once set — an in-app src edit goes through syntax-reveal expand/collapse,
  // which replaces the whole node (fresh state), but any OTHER re-render with
  // a changed `src` attr (e.g. an external sync bringing the missing file
  // into place) left the error card up regardless.
  it("clears the error card once the src attribute actually changes", () => {
    const { container, rerender } = renderVideo({ src: "missing.mp4" });
    fireEvent.error(container.querySelector("video")!);
    expect(container.querySelector(".video-error")).not.toBeNull();

    const props = {
      node: { attrs: { widthPercent: 100, src: "assets/clip.mp4" } },
      updateAttributes: vi.fn(),
      selected: false,
      editor: {} as never,
      getPos: () => 0,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rerender(<VideoView {...(props as any)} />);

    expect(container.querySelector(".video-error")).toBeNull();
    expect(container.querySelector("video")).not.toBeNull();
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

// §296 fullscreen button — jsdom cannot exercise real fullscreen, so this
// asserts the two things that ARE observable: the button's presence tracks
// isFullscreenSupported() (not blind assumption), it is file-branch only, and
// clicking it calls requestVideoFullscreen with the actual <video> element.
describe("VideoView fullscreen button (§296)", () => {
  it("renders when fullscreen is supported, for a local file", () => {
    isFullscreenSupported.mockReturnValue(true);
    const { getByTitle } = renderVideo({ src: "assets/clip.mp4" });
    expect(getByTitle("Fullscreen")).toBeInTheDocument();
  });

  it("does not render when fullscreen is unsupported — a dead button is worse than none", () => {
    isFullscreenSupported.mockReturnValue(false);
    const { queryByTitle } = renderVideo({ src: "assets/clip.mp4" });
    expect(queryByTitle("Fullscreen")).toBeNull();
  });

  it("does not render on the embed branch even when fullscreen is supported", () => {
    isFullscreenSupported.mockReturnValue(true);
    const { queryByTitle } = renderVideo({ src: "https://youtu.be/abc123" });
    expect(queryByTitle("Fullscreen")).toBeNull();
  });

  it("does not render once the file has errored — nothing left to fullscreen", () => {
    isFullscreenSupported.mockReturnValue(true);
    const { container, queryByTitle } = renderVideo({ src: "missing.mp4" });
    fireEvent.error(container.querySelector("video")!);
    expect(queryByTitle("Fullscreen")).toBeNull();
  });

  it("calls requestVideoFullscreen with the actual <video> element on click", () => {
    isFullscreenSupported.mockReturnValue(true);
    const { container, getByTitle } = renderVideo({ src: "assets/clip.mp4" });
    fireEvent.click(getByTitle("Fullscreen"));
    expect(requestVideoFullscreen).toHaveBeenCalledTimes(1);
    expect(requestVideoFullscreen).toHaveBeenCalledWith(
      container.querySelector("video"),
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

// §294 fix round 3 (I1): widthPixel was WRITE-ONLY. video.ts declared it,
// parseVideoHtml filled it, buildVideoHtml preferred it over widthPercent and
// syntax-reveal-image.test.ts pinned it through expand/collapse — but nothing
// read it for rendering, so `<video src="clip.mp4" width="640"></video>` drew
// at 100% while its own markdown said 640px, and a resize drag updated
// widthPercent only: buildVideoHtml still took the widthPixel branch, so the
// file kept `width="640"` and the user's resize was discarded on save with no
// error at all.
describe("VideoView renders and yields the pixel width (§294 I1)", () => {
  function figureWidth(container: HTMLElement): string {
    return (container.querySelector(".video-figure") as HTMLElement).style
      .width;
  }

  /**
   * useMediaResize measures the wrapper, and jsdom reports an all-zero rect
   * for everything — a zero width makes startResize bail before any drag
   * state exists. Injecting a rect is what makes the drag observable at all.
   */
  function stubWrapperRect(container: HTMLElement): void {
    const wrapper = container.querySelector(".video-node-view") as HTMLElement;
    wrapper.getBoundingClientRect = () =>
      ({ left: 0, right: 1000, width: 1000 }) as DOMRect;
  }

  it("draws a pixel width in px, not at 100%", () => {
    const { container } = renderVideo({
      src: "assets/clip.mp4",
      widthPixel: 640,
    });
    expect(figureWidth(container)).toBe("640px");
  });

  it("draws a percentage when there is no pixel width", () => {
    const { container } = renderVideo({
      src: "assets/clip.mp4",
      widthPercent: 60,
    });
    expect(figureWidth(container)).toBe("60%");
  });

  it("ignores a pixel width on an embed, which is always full width (§17.2-6)", () => {
    const { container } = renderVideo({
      src: "https://youtu.be/abc123",
      widthPixel: 640,
    });
    expect(figureWidth(container)).toBe("100%");
  });

  // ‼️ THE test this fix needed: a resize must WIN over a pre-existing pixel
  // width. Without the widthPixel: undefined in the commit, buildVideoHtml
  // keeps writing width="640" and the drag is silently thrown away on save.
  it("a drag beats a pre-existing pixel width, live and on commit", () => {
    const updateAttributes = vi.fn();
    const { container } = renderVideo(
      { src: "assets/clip.mp4", widthPixel: 640 },
      updateAttributes,
    );
    stubWrapperRect(container);

    fireEvent.mouseDown(
      container.querySelector(".media-resize-handle-right")!,
      { clientX: 500 },
    );
    fireEvent.mouseMove(document, { clientX: 400 });

    // Live preview: the drag % is what is drawn, not the 640px still on the node.
    expect(figureWidth(container)).toBe("20%");

    fireEvent.mouseUp(document);

    expect(updateAttributes).toHaveBeenCalledTimes(1);
    // ‼️ toStrictEqual, not toHaveBeenCalledWith. Mutation testing caught the
    // first version of this line: `toHaveBeenCalledWith`/`toEqual` IGNORE a
    // key whose value is undefined, so they cannot tell `{widthPercent: 20}`
    // from `{widthPercent: 20, widthPixel: undefined}` — which is the entire
    // difference this test exists to observe. Deleting the widthPixel from the
    // commit left the assertion green. The key has to be PRESENT: Tiptap's
    // updateAttributes spreads the object over node.attrs, so a missing key
    // leaves the stale 640 in place while an explicit undefined resets it to
    // the schema default.
    expect(updateAttributes.mock.calls[0][0]).toStrictEqual({
      widthPercent: 20,
      widthPixel: undefined,
    });
  });
});
