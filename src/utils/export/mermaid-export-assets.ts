// §5.5 / §55 — rasterize Mermaid blocks to PNG for Pandoc export embedding.
import type { PandocAsset } from "../../ipc/types";

import { stripMermaidMeta } from "../markdown/mermaid-meta";
import { renderMermaidRasterSvg } from "../markdown/mermaid-utils";
import { svgToPngBlob } from "../markdown/svg-utils";

export type MermaidPngRenderer = (code: string) => Promise<number[]>;

/**
 * Replace each ` ```mermaid ` fence with an `![](baram-asset:mermaid-N.png)`
 * reference and return the rasterized PNGs as assets (in document order).
 * On a render failure the original fence is preserved and no asset is emitted.
 */
export async function rewriteMermaidForPandoc(
  markdown: string,
  render: MermaidPngRenderer = defaultRenderer,
): Promise<{ assets: PandocAsset[]; markdown: string }> {
  const lines = markdown.split("\n");
  const out: string[] = [];
  const assets: PandocAsset[] = [];
  let i = 0;
  let idx = 0;

  while (i < lines.length) {
    if (!/^```mermaid\s*$/.test(lines[i])) {
      out.push(lines[i]);
      i++;
      continue;
    }
    // Collect fence body (excluding opening/closing ``` lines)
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !/^```\s*$/.test(lines[j])) {
      body.push(lines[j]);
      j++;
    }
    const code = stripMermaidMeta(body.join("\n"));
    try {
      const data = await render(code);
      const name = `mermaid-${idx}.png`;
      assets.push({ data, name });
      out.push(`![](baram-asset:${name})`);
      idx++;
    } catch (err) {
      console.error("Mermaid export: render failed, keeping source", err);
      out.push("```mermaid");
      out.push(...body);
      out.push("```");
    }
    i = j < lines.length ? j + 1 : j; // skip the closing fence
  }

  return { assets, markdown: out.join("\n") };
}

/** Default renderer: Mermaid source → SVG (SVG text labels) → 2x PNG bytes. */
async function defaultRenderer(code: string): Promise<number[]> {
  const svg = await renderMermaidRasterSvg(code);
  const blob = await svgToPngBlob(svg, 2);
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
