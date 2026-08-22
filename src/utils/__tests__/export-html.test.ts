// §5.12 Export HTML — generateStandaloneHTML unit tests
import type { Editor } from "@tiptap/core";

import { describe, expect, it, vi } from "vitest";

// §294 video export path — activeFileDir() resolves against the active tab's
// file path, so pin one here to test relativizing an asset URL back to a
// path relative to the exported document.
vi.mock("../../stores/editor/editor", () => ({
  useEditorStore: {
    getState: () => ({
      activeTabId: "t1",
      tabs: [{ id: "t1", filePath: "/vault/notes/today.md" }],
    }),
  },
}));

import {
  captureEditorHTML,
  generateStandaloneHTML,
} from "../export/export-html";

/** Build a minimal mock Editor whose view.dom is the given element. */
function mockEditor(dom: HTMLElement): Editor {
  return { view: { dom } } as unknown as Editor;
}

describe("generateStandaloneHTML", () => {
  it("produces valid HTML5 document with DOCTYPE and charset", () => {
    const html = generateStandaloneHTML("<p>Hello</p>", "Test");
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain("<html lang=");
  });

  it("includes the title in <title> tag", () => {
    const html = generateStandaloneHTML("<p>Content</p>", "My Document");
    expect(html).toContain("<title>My Document</title>");
  });

  it("wraps editor HTML in <article class='baram-export'>", () => {
    const editorHTML = "<h1>Title</h1><p>Body text</p>";
    const html = generateStandaloneHTML(editorHTML, "Test");
    expect(html).toContain(
      `<article class="baram-export">${editorHTML}</article>`,
    );
  });

  it("includes KaTeX CSS style block (raw import may be empty in test env)", () => {
    const html = generateStandaloneHTML("<p>x</p>", "Test");
    // The first <style> block is for KaTeX CSS (may be empty in vitest jsdom)
    // Verify the structure has 3 style blocks: katex, editor, print
    const styleBlocks = html.match(/<style>/g);
    expect(styleBlocks?.length).toBe(3);
  });

  it("includes @media print rules", () => {
    const html = generateStandaloneHTML("<p>x</p>", "Test");
    expect(html).toContain("@media print");
    expect(html).toContain("page-break");
  });

  it("handles empty editor HTML", () => {
    const html = generateStandaloneHTML("", "Empty");
    expect(html).toContain('<article class="baram-export"></article>');
    expect(html).toContain("<title>Empty</title>");
  });

  it("escapes special characters in title", () => {
    const html = generateStandaloneHTML(
      "<p>x</p>",
      'A <script>"alert"</script> & B',
    );
    expect(html).toContain(
      "<title>A &lt;script&gt;&quot;alert&quot;&lt;/script&gt; &amp; B</title>",
    );
    // Must NOT contain unescaped script tag in title
    expect(html).not.toContain("<title>A <script>");
  });

  it("includes editor typography CSS", () => {
    const html = generateStandaloneHTML("<p>x</p>", "Test");
    expect(html).toContain("article.baram-export");
    expect(html).toContain("blockquote");
    expect(html).toContain("border-collapse");
  });

  it("includes Baram generator meta tag", () => {
    const html = generateStandaloneHTML("<p>x</p>", "Test");
    expect(html).toContain('<meta name="generator" content="Baram">');
  });

  it("hides media-block interactive UI in print CSS", () => {
    const html = generateStandaloneHTML("<p>x</p>", "Test");
    expect(html).toContain(".media-toolbar");
    expect(html).toContain("display: none !important");
  });

  it("constrains tall mermaid diagrams to one page in print CSS", () => {
    const html = generateStandaloneHTML("<p>x</p>", "Test");
    // Print rule must cap diagram height to the page box (vh) so it never
    // spans multiple pages, while preserving aspect ratio.
    expect(html).toContain("max-height: 90vh !important");
  });
});

describe("captureEditorHTML — mermaid interactive UI stripping", () => {
  it("removes the shared media toolbar (AI / copy / expand buttons) but keeps the SVG", async () => {
    const dom = document.createElement("div");
    dom.innerHTML = `
      <div class="mermaid-block mermaid-block-preview">
        <svg class="mermaid-svg"><g></g></svg>
        <div class="media-toolbar">
          <button class="media-toolbar-btn">AI</button>
          <button class="media-toolbar-btn">복사</button>
          <button class="media-toolbar-btn">확장</button>
        </div>
      </div>`;

    const html = await captureEditorHTML(mockEditor(dom));

    expect(html).not.toContain("media-toolbar");
    expect(html).not.toContain(">AI<");
    expect(html).not.toContain(">복사<");
    expect(html).not.toContain(">확장<");
    // Rendered diagram must survive the cleanup.
    expect(html).toContain("mermaid-svg");
  });

  it("removes the mermaid context menu portal markup", async () => {
    const dom = document.createElement("div");
    dom.innerHTML = `
      <div class="mermaid-block">
        <svg class="mermaid-svg"></svg>
        <div class="mermaid-context-menu"><button>Copy as SVG</button></div>
      </div>`;

    const html = await captureEditorHTML(mockEditor(dom));

    expect(html).not.toContain("mermaid-context-menu");
    expect(html).toContain("mermaid-svg");
  });
});

describe("captureEditorHTML — mermaid diagram sizing normalization", () => {
  it("pins natural size from viewBox and drops mermaid's inline max-width", async () => {
    const dom = document.createElement("div");
    dom.innerHTML = `
      <div class="mermaid-block-svg">
        <svg viewBox="0 0 480 300" style="max-width: 480px;"><g></g></svg>
      </div>`;

    const html = await captureEditorHTML(mockEditor(dom));

    // Natural dimensions pinned as attributes (drives intrinsic aspect ratio).
    expect(html).toContain('width="480"');
    expect(html).toContain('height="300"');
    // Mermaid's inline max-width cap must be gone so export CSS governs sizing.
    expect(html).not.toContain("max-width: 480px");
    expect(html).not.toContain("max-width:480px");
  });

  it("rounds fractional viewBox dimensions", async () => {
    const dom = document.createElement("div");
    dom.innerHTML = `
      <div class="mermaid-block-svg">
        <svg viewBox="0 0 764.5 512.25" style="max-width: 764.5px;"></svg>
      </div>`;

    const html = await captureEditorHTML(mockEditor(dom));

    expect(html).toContain('width="765"');
    expect(html).toContain('height="512"');
  });

  it("leaves a viewBox-less svg without pinned dimensions", async () => {
    const dom = document.createElement("div");
    dom.innerHTML = `
      <div class="mermaid-block-svg">
        <svg style="max-width: 200px;"></svg>
      </div>`;

    const html = await captureEditorHTML(mockEditor(dom));

    // No viewBox → cannot derive natural size; still strips the inline cap.
    expect(html).not.toContain('width="');
    expect(html).not.toContain("max-width: 200px");
  });
});

describe("captureEditorHTML — video src rewriting for HTML export (§294)", () => {
  // Mocked active tab's file lives at /vault/notes/today.md → dirname is
  // /vault/notes (see the useEditorStore mock above).
  const DOC_DIR = "/vault/notes";

  /**
   * Reproduces the real asset URL shape, not a hand-typed approximation.
   * `@tauri-apps/api/mocks`' `mockConvertFileSrc` — the Tauri team's own
   * stand-in for the native implementation — percent-encodes the ENTIRE
   * absolute path with `encodeURIComponent`, slashes included, so
   * `/vault/notes/assets/clip.mp4` becomes `%2Fvault%2Fnotes%2Fassets%2Fclip.mp4`
   * before the scheme wraps it. Building fixtures any other way would test
   * a URL shape that never occurs in the app.
   */
  function assetUrl(absPath: string, windows = false): string {
    const encoded = encodeURIComponent(absPath);
    return windows
      ? `http://asset.localhost/${encoded}`
      : `asset://localhost/${encoded}`;
  }

  function videoDom(src: string): HTMLElement {
    const dom = document.createElement("div");
    dom.innerHTML = `<video src="${src}" preload="metadata"></video>`;
    return dom;
  }

  it("keeps a video under the document's directory relative, folder included", async () => {
    const src = `${assetUrl(`${DOC_DIR}/assets/clip.mp4`)}#t=0.1`;
    const html = await captureEditorHTML(mockEditor(videoDom(src)));

    expect(html).toContain('src="assets/clip.mp4"');
  });

  it("keeps a nested relative path in full, not reduced to its basename", async () => {
    const src = `${assetUrl(`${DOC_DIR}/media/sub/clip.mp4`)}#t=0.1`;
    const html = await captureEditorHTML(mockEditor(videoDom(src)));

    // The bug this guards: an earlier version did `.split("/").pop()`, which
    // would have produced "clip.mp4" here — playable only by accident, when
    // the file happens to sit directly in assets/ next to the document.
    expect(html).toContain('src="media/sub/clip.mp4"');
  });

  it("leaves an out-of-tree absolute path absolute rather than reducing it to a basename", async () => {
    const src = `${assetUrl("/Users/other/Downloads/clip.mp4")}#t=0.1`;
    const html = await captureEditorHTML(mockEditor(videoDom(src)));

    expect(html).toContain('src="/Users/other/Downloads/clip.mp4"');
  });

  it("strips the #t=0.1 poster-frame fragment in every case", async () => {
    const underTree = await captureEditorHTML(
      mockEditor(videoDom(`${assetUrl(`${DOC_DIR}/assets/clip.mp4`)}#t=0.1`)),
    );
    const outOfTree = await captureEditorHTML(
      mockEditor(videoDom(`${assetUrl("/Users/other/clip.mp4")}#t=0.1`)),
    );

    expect(underTree).not.toContain("t=0.1");
    expect(outOfTree).not.toContain("t=0.1");
  });

  it("handles the Windows asset URL spelling (http://asset.localhost/) identically", async () => {
    const src = `${assetUrl(`${DOC_DIR}/assets/clip.mp4`, true)}#t=0.1`;
    const html = await captureEditorHTML(mockEditor(videoDom(src)));

    expect(html).toContain('src="assets/clip.mp4"');
  });

  it("leaves a remote https URL untouched", async () => {
    const html = await captureEditorHTML(
      mockEditor(videoDom("https://example.com/clip.mp4")),
    );

    expect(html).toContain('src="https://example.com/clip.mp4"');
  });

  // §294 fix (M4 nit): the fragment-stripping above only ran inside the
  // asset-URL branch, so a REMOTE (non-asset) video kept `#t=0.1` — harmless
  // for HTML playback, but once that src is turned into a PDF export link
  // (forPdf, tested elsewhere in this file) the fragment became part of the
  // link's VISIBLE TEXT: "https://…/clip.mp4#t=0.1" instead of the clean URL.
  it("strips the #t=0.1 poster-frame fragment from a remote https URL too", async () => {
    const html = await captureEditorHTML(
      mockEditor(videoDom("https://example.com/clip.mp4#t=0.1")),
    );

    expect(html).toContain('src="https://example.com/clip.mp4"');
    expect(html).not.toContain("t=0.1");
  });
});

// §294/§301 fix (I4): the exported video had no play affordance, a dead
// leftover play button, no link for a provider embed, and PDF export carried
// an unplayable <video> instead of §301's "link only" fallback.
describe("captureEditorHTML — video export playability (§294/§301 I4)", () => {
  function domWith(html: string): HTMLElement {
    const dom = document.createElement("div");
    dom.innerHTML = html;
    return dom;
  }

  it("adds controls to a local video for HTML export", async () => {
    const html = await captureEditorHTML(
      mockEditor(domWith('<video src="https://example.com/clip.mp4"></video>')),
    );
    expect(html).toContain("controls");
  });

  it("replaces the video with a link instead, for PDF export (§301 — no poster frame pretending playback)", async () => {
    const html = await captureEditorHTML(
      mockEditor(domWith('<video src="https://example.com/clip.mp4"></video>')),
      { forPdf: true },
    );
    expect(html).not.toContain("<video");
    expect(html).toContain(
      '<a class="video-export-link" href="https://example.com/clip.mp4">https://example.com/clip.mp4</a>',
    );
  });

  it("replaces a provider embed card with a link to the ORIGINAL src, not the constructed nocookie embed URL", async () => {
    const html = await captureEditorHTML(
      mockEditor(
        domWith(
          '<div class="video-embed-card" data-video-src="https://youtu.be/dQw4w9WgXcQ"><span class="video-embed-host">www.youtube-nocookie.com</span></div>',
        ),
      ),
    );
    expect(html).not.toContain("video-embed-card");
    expect(html).not.toContain("youtube-nocookie.com");
    expect(html).toContain(
      '<a class="video-export-link" href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a>',
    );
  });

  // §294/§301 fix (M2): a PLAYING embed is a `.video-embed-frame` iframe, not
  // the idle `.video-embed-card` above — before this fix nothing converted
  // it, so it exported as a verbatim, inert `<iframe>` for PDF (exactly the
  // §301 violation I4 set out to close, reached through the other shape).
  it("leaves a playing embed iframe untouched for HTML export — it's self-contained and plays fine without JS", async () => {
    const html = await captureEditorHTML(
      mockEditor(
        domWith(
          '<iframe class="video-embed-frame" data-video-src="https://youtu.be/dQw4w9WgXcQ" src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>',
        ),
      ),
    );
    expect(html).toContain("<iframe");
    expect(html).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  });

  it("replaces a playing embed iframe with a link to the ORIGINAL src for PDF export", async () => {
    const pdf = await captureEditorHTML(
      mockEditor(
        domWith(
          '<iframe class="video-embed-frame" data-video-src="https://youtu.be/dQw4w9WgXcQ" src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>',
        ),
      ),
      { forPdf: true },
    );
    expect(pdf).not.toContain("<iframe");
    expect(pdf).not.toContain("youtube-nocookie.com");
    expect(pdf).toContain(
      '<a class="video-export-link" href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a>',
    );
  });
});

// §294 fix (I4, dev/backlog.md 2026-08-22): video's caption input had no
// image-caption-input-equivalent class, so exporting mid-caption-edit leaked
// a raw <input> for video specifically. Both media kinds now share one class.
describe("captureEditorHTML — in-progress caption edit is never exported as a raw <input> (§294 I4)", () => {
  function captionDom(containerClass: string, value: string): HTMLElement {
    const dom = document.createElement("div");
    dom.innerHTML = `<figcaption class="${containerClass}"><input class="media-caption-input" value="${value}" /></figcaption>`;
    return dom;
  }

  it("replaces an image's in-progress caption input with plain text", async () => {
    const html = await captureEditorHTML(
      mockEditor(captionDom("image-caption image-caption-editing", "a cat")),
    );
    expect(html).not.toContain("<input");
    expect(html).toContain("<span>a cat</span>");
  });

  it("replaces a video's in-progress caption input with plain text (the gap this fix closes)", async () => {
    const html = await captureEditorHTML(
      mockEditor(captionDom("video-caption", "a clip")),
    );
    expect(html).not.toContain("<input");
    expect(html).toContain("<span>a clip</span>");
  });

  it("removes an empty caption input entirely rather than exporting a blank span", async () => {
    const html = await captureEditorHTML(
      mockEditor(captionDom("video-caption", "")),
    );
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<span>");
  });

  // §294 fix (M4): BlockCaption.tsx (SVG §5.1 / Mermaid §5.5) carried only
  // its own `block-caption-input` class, which this stripping loop never
  // matched — the gap the I4 fix's comment claimed was already closed for
  // "every media kind". Reproduces BlockCaption's actual rendered markup
  // (both classes on one <input>), not a hand-picked class this loop happens
  // to look for.
  it("replaces a Mermaid/SVG caption's in-progress edit (BlockCaption's real two-class input) with plain text", async () => {
    const dom = document.createElement("div");
    dom.innerHTML =
      '<div class="block-caption block-caption-editing">' +
      '<input class="block-caption-input media-caption-input" value="a diagram" />' +
      "</div>";
    const html = await captureEditorHTML(mockEditor(dom));
    expect(html).not.toContain("<input");
    expect(html).toContain("<span>a diagram</span>");
  });
});

// §294 fix round 3 (M12b): every video fixture in this file was a synthetic
// bare `<video src>`, so nothing covered the shape the app actually produces
// for a RESIZED video — video-view.tsx wraps it in
// `<figure class="video-figure" style="width: 60%">`. The export path rewrites
// the `<video>` element itself (src, preload, controls / PDF link) and strips
// the hover chrome around it, all of which reach INTO the figure; a stray
// `figure` selector or a replaceWith on the wrong node would silently drop the
// user's size from the exported document with the suite still green.
describe("captureEditorHTML — a resized video keeps its width (§294 M12b)", () => {
  function resizedVideoDom(width: string, extras = ""): HTMLElement {
    const dom = document.createElement("div");
    dom.innerHTML =
      `<div class="video-node-view">` +
      `<figure class="video-figure" style="width: ${width}">` +
      `<video src="https://example.com/clip.mp4" preload="metadata"></video>` +
      extras +
      `</figure></div>`;
    return dom;
  }

  it("keeps a percentage width on the figure for HTML export", async () => {
    const html = await captureEditorHTML(mockEditor(resizedVideoDom("60%")));
    expect(html).toContain("video-figure");
    expect(html).toContain("width: 60%");
    expect(html).toContain("controls");
  });

  it("keeps a pixel width on the figure (§294 I1's render branch)", async () => {
    const html = await captureEditorHTML(mockEditor(resizedVideoDom("640px")));
    expect(html).toContain("width: 640px");
  });

  it("keeps the width while dropping the resize chrome inside the figure", async () => {
    const html = await captureEditorHTML(
      mockEditor(
        resizedVideoDom(
          "60%",
          `<div class="media-resize-handle media-resize-handle-left"></div>` +
            `<div class="media-resize-label">60%</div>`,
        ),
      ),
    );
    expect(html).toContain("width: 60%");
    expect(html).not.toContain("media-resize-handle");
    expect(html).not.toContain("media-resize-label");
  });

  it("keeps the width for PDF export, where the video becomes a link", async () => {
    const html = await captureEditorHTML(mockEditor(resizedVideoDom("60%")), {
      forPdf: true,
    });
    expect(html).toContain("width: 60%");
    expect(html).not.toContain("<video");
    expect(html).toContain('class="video-export-link"');
  });
});
