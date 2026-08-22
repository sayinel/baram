// §294 final-gate Important #3 — what a REFUSED media tag actually looks like
// on screen.
//
// The refuse-and-preserve policy (media-html-tag.ts) lands every tag it cannot
// represent losslessly in an `htmlBlock`. That keeps the user's file intact,
// which is the point. But this view injects the sanitized HTML verbatim and
// used to resolve NO paths, so a LOCAL image inside an htmlBlock could not load
// in the Tauri webview at all — a relative `src` only works once it has been
// rewritten to `asset:`. The outcome for `<img src="assets/photo.png"
// height="200">` was therefore "file intact, nothing on screen", which is worse
// than the "renders, height quietly lost on save" it replaced.
//
// ‼️ No existing test asserted the RENDERED result of a refusal — the gate's
// central point. These do.
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

// Mutable so a test can move the active tab and force the effect to run a
// SECOND time against a DOM that already holds this view's own output.
const tabState = vi.hoisted(() => ({
  activeTabId: "t1",
  tabs: [{ id: "t1", filePath: "/vault/notes/today.md" }],
}));

vi.mock("../../stores/editor/editor", () => ({
  useEditorStore: { getState: () => tabState },
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

import { HtmlBlockView } from "../nodes/html-block-view";

function htmlBlockProps(content: string) {
  return {
    node: { attrs: { content }, nodeSize: 1 },
    updateAttributes: vi.fn(),
    selected: false,
    editor: {} as never,
    getPos: () => 0,
  };
}

function imgSrc(container: HTMLElement): null | string {
  return container.querySelector("img")?.getAttribute("src") ?? null;
}

function renderHtmlBlock(content: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return render(<HtmlBlockView {...(htmlBlockProps(content) as any)} />);
}

describe("HtmlBlockView resolves relative media srcs (§294 gate I3)", () => {
  beforeEach(() => {
    // The re-render test moves the active tab; without this the next test
    // inherits it and its expected asset path silently changes.
    tabState.tabs[0].filePath = "/vault/notes/today.md";
  });

  it("rewrites a relative local img src to an asset: URL so it can load", () => {
    // The exact markup the allowlist refuses today: `height` is not in
    // IMG_TAG.allowedAttrs, so this whole tag lands here verbatim.
    const { container } = renderHtmlBlock(
      '<img src="assets/photo.png" height="200">',
    );
    expect(imgSrc(container)).toBe(
      "asset://localhost//vault/notes/assets/photo.png",
    );
  });

  it("resolves an absolute local path too", () => {
    const { container } = renderHtmlBlock('<img src="/abs/photo.png">');
    expect(imgSrc(container)).toBe("asset://localhost//abs/photo.png");
  });

  it("leaves a remote https src untouched", () => {
    const { container } = renderHtmlBlock(
      '<img src="https://example.com/a.png" height="200">',
    );
    expect(imgSrc(container)).toBe("https://example.com/a.png");
  });

  it("leaves a data URI untouched", () => {
    const { container } = renderHtmlBlock(
      '<img src="data:image/png;base64,AAAA">',
    );
    expect(imgSrc(container)).toBe("data:image/png;base64,AAAA");
  });

  // ‼️ THE regression this fix nearly shipped with. React 19 compares the
  // `dangerouslySetInnerHTML` prop by OBJECT IDENTITY, and a fresh `{ __html }`
  // literal is created every render, so React re-injects innerHTML on every
  // re-render even when the sanitized string is byte-identical — wiping the
  // resolved srcs. The first version of the effect had deps `[html, baseDir]`,
  // so it did not re-run and the image went blank again after any unrelated
  // re-render. Measured, not reasoned: with those deps this test reads back the
  // raw "a.png". The effect now has no dependency array, matching React's own
  // re-injection cadence.
  it("keeps the src resolved after an unrelated re-render", () => {
    const { container, rerender } = renderHtmlBlock('<img src="a.png">');
    expect(imgSrc(container)).toBe("asset://localhost//vault/notes/a.png");

    rerender(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <HtmlBlockView {...(htmlBlockProps('<img src="a.png">') as any)} />,
    );

    expect(imgSrc(container)).toBe("asset://localhost//vault/notes/a.png");
  });

  // Not a bug: activeFileDir() is the documented §286-inherited behavior — a
  // retained surface resolves relative paths against the ACTIVE tab, exactly as
  // image-view and video-view do. Pinned so the re-resolution is deliberate
  // rather than accidental.
  it("re-resolves against the new directory when the active tab changes", () => {
    const { container, rerender } = renderHtmlBlock('<img src="a.png">');
    expect(imgSrc(container)).toBe("asset://localhost//vault/notes/a.png");

    tabState.tabs[0].filePath = "/vault/other/note.md";
    rerender(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      <HtmlBlockView {...(htmlBlockProps('<img src="a.png">') as any)} />,
    );

    expect(imgSrc(container)).toBe("asset://localhost//vault/other/a.png");
  });

  it("resolves every img in a multi-image block, not just the first", () => {
    const { container } = renderHtmlBlock(
      '<div><img src="a.png"><img src="b.png"></div>',
    );
    const srcs = [...container.querySelectorAll("img")].map((el) =>
      el.getAttribute("src"),
    );
    expect(srcs).toEqual([
      "asset://localhost//vault/notes/a.png",
      "asset://localhost//vault/notes/b.png",
    ]);
  });

  // ‼️ The resolution runs on the DOM AFTER DOMPurify, and only assigns to an
  // existing attribute — it never re-parses or re-injects markup. These pin
  // that the sanitizer is still doing its job around it, because this view is
  // the security review's designated safe fallback for refused tags.
  it("still strips a script tag alongside the resolution", () => {
    const { container } = renderHtmlBlock(
      '<div><script>alert(1)</script><img src="a.png"></div>',
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("alert(1)");
    expect(imgSrc(container)).toBe("asset://localhost//vault/notes/a.png");
  });

  it("still strips an onerror handler from the img it resolves", () => {
    const { container } = renderHtmlBlock(
      '<img src="a.png" onerror="alert(1)">',
    );
    const img = container.querySelector("img")!;
    expect(img.hasAttribute("onerror")).toBe(false);
    expect(img.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/a.png",
    );
  });

  // ‼️ THE case the verification pass found, driven through the real component
  // and therefore the real SANITIZE_CONFIG. The premise behind the original
  // `img[src]` selector was that DOMPurify strips `<video>`; it does not.
  // `USE_PROFILES: { html: true }` already allows video/audio/source/track and
  // `ADD_TAGS` only ADDS to that set, so a refused `<video>` rendered as a LIVE
  // player pointing at an unresolved relative path — an empty black box, which
  // reads as a broken app rather than as preserved markup.
  it("renders a refused <video> live, with its src resolved", () => {
    const { container } = renderHtmlBlock(
      '<video src="assets/clip.mp4" controls poster="p.jpg"></video>',
    );
    const video = container.querySelector("video");
    // Half the point: the element survives sanitization at all.
    expect(video).not.toBeNull();
    expect(video!.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/assets/clip.mp4",
    );
    expect(video!.getAttribute("poster")).toBe(
      "asset://localhost//vault/notes/p.jpg",
    );
  });

  it("resolves a <source> child of a preserved video", () => {
    const { container } = renderHtmlBlock(
      '<video><source src="assets/clip.mp4"></video>',
    );
    expect(container.querySelector("source")?.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/assets/clip.mp4",
    );
  });

  // ‼️ Security-relevant record, verified against the real package rather than
  // assumed: `iframe`, `object` and `embed` are NOT in the html profile the way
  // video is, so a refused tag carrying one cannot render live in an htmlBlock.
  // This is the assertion that would go red if a future ADD_TAGS edit widened
  // the sanitizer, and it is why "video renders live" is a rendering finding
  // rather than a security one.
  it("still strips iframe, object and embed entirely", () => {
    const { container } = renderHtmlBlock(
      '<div><iframe src="https://evil.test/x"></iframe>' +
        '<object data="https://evil.test/y"></object>' +
        '<embed src="https://evil.test/z"></div>',
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("object")).toBeNull();
    expect(container.querySelector("embed")).toBeNull();
    expect(container.innerHTML).not.toContain("evil.test");
  });

  it("strips an onerror handler from a preserved video too", () => {
    const { container } = renderHtmlBlock(
      '<video src="a.mp4" onerror="alert(1)"></video>',
    );
    const video = container.querySelector("video")!;
    expect(video.hasAttribute("onerror")).toBe(false);
    expect(video.getAttribute("src")).toBe(
      "asset://localhost//vault/notes/a.mp4",
    );
  });

  it("does not invent an img where the markup had none", () => {
    const { container } = renderHtmlBlock("<div>plain</div>");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("plain");
  });
});
