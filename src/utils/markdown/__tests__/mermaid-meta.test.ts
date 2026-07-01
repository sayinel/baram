import { describe, expect, it } from "vitest";

import {
  parseMermaidMeta,
  setMermaidMeta,
  stripMermaidMeta,
} from "../mermaid-meta";

describe("mermaid-meta", () => {
  const diagram = "flowchart LR\n  A --> B";

  it("parses width + caption from the meta line", () => {
    const code = `%% baram-meta: {"width":50,"caption":"My diagram"}\n${diagram}`;
    expect(parseMermaidMeta(code)).toEqual({
      caption: "My diagram",
      width: 50,
    });
  });

  it("returns nulls when there is no meta line", () => {
    expect(parseMermaidMeta(diagram)).toEqual({ caption: null, width: null });
  });

  it("strips the meta line before rendering", () => {
    const code = `%% baram-meta: {"width":50}\n${diagram}`;
    expect(stripMermaidMeta(code)).toBe(diagram);
  });

  it("upserts width, keeping the diagram intact", () => {
    const out = setMermaidMeta(diagram, { caption: null, width: 60 });
    expect(out).toBe(`%% baram-meta: {"width":60}\n${diagram}`);
    expect(stripMermaidMeta(out)).toBe(diagram);
  });

  it("replaces an existing meta line rather than stacking", () => {
    const once = setMermaidMeta(diagram, { caption: "A", width: 40 });
    const twice = setMermaidMeta(once, { caption: "A", width: 70 });
    expect((twice.match(/baram-meta/g) || []).length).toBe(1);
    expect(parseMermaidMeta(twice)).toEqual({ caption: "A", width: 70 });
  });

  it("removes the meta line when width and caption are both empty", () => {
    const withMeta = setMermaidMeta(diagram, { caption: "x", width: 50 });
    expect(setMermaidMeta(withMeta, { caption: null, width: null })).toBe(
      diagram,
    );
  });

  it("places the meta line after frontmatter so mermaid still parses", () => {
    const fm = `---\ntitle: T\n---\n${diagram}`;
    const out = setMermaidMeta(fm, { caption: null, width: 50 });
    expect(out).toBe(
      `---\ntitle: T\n---\n%% baram-meta: {"width":50}\n${diagram}`,
    );
  });

  it("round-trips a caption containing JSON-special characters", () => {
    const caption = 'has "quotes" and {braces}';
    const out = setMermaidMeta(diagram, { caption, width: null });
    expect(parseMermaidMeta(out).caption).toBe(caption);
  });
});
