import { describe, expect, it, vi } from "vitest";

import { rewriteMermaidForPandoc } from "../mermaid-export-assets";

const fakeRender = vi.fn(async (_code: string) => [137, 80, 78, 71]); // fake PNG bytes

describe("rewriteMermaidForPandoc", () => {
  it("replaces mermaid fences with image refs and collects assets in order", async () => {
    const md = [
      "# Title",
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "text",
      "```mermaid",
      "sequenceDiagram",
      "```",
    ].join("\n");

    const { markdown, assets } = await rewriteMermaidForPandoc(md, fakeRender);

    expect(markdown).toContain("![](baram-asset:mermaid-0.png)");
    expect(markdown).toContain("![](baram-asset:mermaid-1.png)");
    expect(markdown).not.toContain("```mermaid");
    expect(assets).toHaveLength(2);
    expect(assets[0]).toEqual({
      name: "mermaid-0.png",
      data: [137, 80, 78, 71],
    });
  });

  it("strips baram-meta before rendering", async () => {
    const render = vi.fn(async (_code: string) => [1, 2]);
    const md = [
      "```mermaid",
      '%% baram-meta: {"width":50}',
      "graph TD",
      "```",
    ].join("\n");
    await rewriteMermaidForPandoc(md, render);
    expect(render).toHaveBeenCalledWith("graph TD");
  });

  it("keeps the original fence when rendering fails", async () => {
    const render = vi.fn(async () => {
      throw new Error("render failed");
    });
    const md = ["```mermaid", "graph TD", "```"].join("\n");
    const { markdown, assets } = await rewriteMermaidForPandoc(md, render);
    expect(markdown).toContain("```mermaid");
    expect(markdown).toContain("graph TD");
    expect(assets).toHaveLength(0);
  });

  it("leaves non-mermaid content unchanged", async () => {
    const md = ["para", "```js", "code", "```"].join("\n");
    const { markdown, assets } = await rewriteMermaidForPandoc(md, fakeRender);
    expect(markdown).toBe(md);
    expect(assets).toHaveLength(0);
  });
});
