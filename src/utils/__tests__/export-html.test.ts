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
});
