// Integration: HTML Export Pipeline — MD → PM content verification + standalone HTML export
//
// Note: DOMSerializer requires toDOM specs in schema (provided by Tiptap extensions at runtime).
// In test environment without full Tiptap editor, we verify:
// 1. Pipeline preserves content that would appear in exported HTML
// 2. generateStandaloneHTML produces valid HTML5 with editor-like content
//
import { describe, expect, it } from "vitest";

import { markdownToProsemirror } from "../../pipeline/md-to-pm";
import { prosemirrorToMarkdown } from "../../pipeline/pm-to-md";
import { generateStandaloneHTML } from "../../utils/export-html";
import { createTestSchema, FIXTURE_RICH } from "./fixtures";

const schema = createTestSchema();

describe("Integration: HTML Export Pipeline", () => {
  it("MD → PM → MD preserves all content types for export", () => {
    // Verify pipeline preserves the content that export would serialize
    const doc = markdownToProsemirror(FIXTURE_RICH, schema);
    const md = prosemirrorToMarkdown(doc);

    // All content types survive pipeline (pre-requisite for correct export)
    expect(md).toContain("# Rich Content");
    expect(md).toContain("$E = mc^2$");
    expect(md).toContain("$$");
    expect(md).toContain("\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}");
    expect(md).toContain("```typescript");
    expect(md).toContain("const x: number = 42;");
    expect(md).toContain("Name");
    expect(md).toContain("alpha");

    // Generate standalone HTML with representative editor content
    const editorHTML = [
      "<h1>Rich Content</h1>",
      '<p>Inline math <span class="math-inline">E = mc^2</span> in a paragraph.</p>',
      '<div class="math-block"><span class="math-block-katex">\\frac{-b}{2a}</span></div>',
      '<pre><code class="language-typescript">const x: number = 42;</code></pre>',
      "<table><tr><th>Name</th><th>Value</th></tr><tr><td>alpha</td><td>1</td></tr></table>",
    ].join("\n");

    const standalone = generateStandaloneHTML(editorHTML, "Test Document");

    // Valid HTML5 structure
    expect(standalone).toContain("<!DOCTYPE html>");
    expect(standalone).toContain('<meta charset="UTF-8">');
    expect(standalone).toContain('<meta name="generator" content="Baram">');
    expect(standalone).toContain("<title>Test Document</title>");
    expect(standalone).toContain('<article class="baram-export">');

    // 3 style blocks (KaTeX, editor, print)
    const styleCount = (standalone.match(/<style>/g) || []).length;
    expect(styleCount).toBe(3);

    // Content is embedded
    expect(standalone).toContain("<h1>Rich Content</h1>");
    expect(standalone).toContain("math-block");
    expect(standalone).toContain("language-typescript");
    expect(standalone).toContain("<table>");
  });

  it("math content preserved through pipeline and CSS available in export", () => {
    const mathMD = "$$\nE = mc^2\n$$\n";
    const doc = markdownToProsemirror(mathMD, schema);
    const md = prosemirrorToMarkdown(doc);

    // Math formula preserved in pipeline
    expect(md).toContain("$$\nE = mc^2\n$$");

    // Export includes math-block CSS for rendering
    const standalone = generateStandaloneHTML(
      '<div class="math-block"><span class="math-block-katex">E = mc^2</span></div>',
      "Math",
    );
    expect(standalone).toContain(".math-block");
    expect(standalone).toContain("E = mc^2");
  });

  it("code block language preserved through pipeline and styled in export", () => {
    const codeMD = "```typescript\nconst x = 42;\n```\n";
    const doc = markdownToProsemirror(codeMD, schema);
    const md = prosemirrorToMarkdown(doc);

    // Language preserved
    expect(md).toContain("```typescript");
    expect(md).toContain("const x = 42;");

    // Export includes code styling
    const standalone = generateStandaloneHTML(
      '<pre><code class="language-typescript">const x = 42;</code></pre>',
      "Code",
    );
    expect(standalone).toContain("pre code");
    expect(standalone).toContain("language-typescript");
  });

  it("table content preserved through pipeline and structured in export", () => {
    const tableMD = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const doc = markdownToProsemirror(tableMD, schema);
    const md = prosemirrorToMarkdown(doc);

    // Table content preserved
    expect(md).toContain("A");
    expect(md).toContain("B");
    expect(md).toContain("1");
    expect(md).toContain("2");

    // Export includes table structure + CSS
    const standalone = generateStandaloneHTML(
      "<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
      "Table",
    );
    expect(standalone).toContain("border-collapse: collapse");
    expect(standalone).toContain("<table>");
    expect(standalone).toContain("<th>A</th>");
    expect(standalone).toContain("<td>1</td>");
  });

  it("empty document exports as valid HTML", () => {
    const standalone = generateStandaloneHTML("", "Empty");

    expect(standalone).toContain("<!DOCTYPE html>");
    expect(standalone).toContain('<article class="baram-export">');
    expect(standalone).toContain("</article>");
    expect(standalone).toContain("<title>Empty</title>");
  });
});
