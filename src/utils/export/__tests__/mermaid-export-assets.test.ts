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

  it("does not consume an asset index when an earlier render fails", async () => {
    let call = 0;
    const render = vi.fn(async () => {
      call += 1;
      if (call === 1) throw new Error("boom");
      return [1, 2, 3];
    });
    const md = [
      "```mermaid",
      "graph TD",
      "```",
      "```mermaid",
      "sequenceDiagram",
      "```",
    ].join("\n");

    const { markdown, assets } = await rewriteMermaidForPandoc(md, render);

    expect(assets).toHaveLength(1);
    expect(assets[0].name).toBe("mermaid-0.png"); // second (successful) diagram is still 0
    expect(markdown).toContain("```mermaid"); // first (failed) fence kept as source
    expect(markdown).toContain("graph TD");
    expect(markdown).toContain("![](baram-asset:mermaid-0.png)");
  });

  it("leaves non-mermaid content unchanged", async () => {
    const md = ["para", "```js", "code", "```"].join("\n");
    const { markdown, assets } = await rewriteMermaidForPandoc(md, fakeRender);
    expect(markdown).toBe(md);
    expect(assets).toHaveLength(0);
  });
});
