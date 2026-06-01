// §5.12 Export HTML — generateStandaloneHTML unit tests
import type { Editor } from "@tiptap/core";

import { describe, expect, it } from "vitest";

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

  it("hides mermaid interactive UI in print CSS", () => {
    const html = generateStandaloneHTML("<p>x</p>", "Test");
    expect(html).toContain(".mermaid-hover-toolbar");
    expect(html).toContain("display: none !important");
  });
});

describe("captureEditorHTML — mermaid interactive UI stripping", () => {
  it("removes the mermaid hover toolbar (AI / copy / expand buttons) but keeps the SVG", async () => {
    const dom = document.createElement("div");
    dom.innerHTML = `
      <div class="mermaid-block mermaid-block-preview">
        <svg class="mermaid-svg"><g></g></svg>
        <div class="mermaid-hover-toolbar">
          <button class="mermaid-hover-toolbar-btn">AI</button>
          <button class="mermaid-hover-toolbar-btn">복사</button>
          <button class="mermaid-hover-toolbar-btn">확장</button>
        </div>
      </div>`;

    const html = await captureEditorHTML(mockEditor(dom));

    expect(html).not.toContain("mermaid-hover-toolbar");
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
