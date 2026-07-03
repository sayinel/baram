// §5.5 / §55 — rasterize Mermaid blocks to PNG for Pandoc export embedding.
import type { PandocAsset } from "../../ipc/types";

import { segmentMarkdownByMermaid } from "../markdown/mermaid-fence";
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
  const segments = segmentMarkdownByMermaid(markdown);
  const out: string[] = [];
  const assets: PandocAsset[] = [];
  let idx = 0;

  for (const seg of segments) {
    if (seg.kind === "text") {
      out.push(...seg.lines);
      continue;
    }
    const code = stripMermaidMeta(seg.body.join("\n"));
    try {
      const data = await render(code);
      const name = `mermaid-${idx}.png`;
      assets.push({ data, name });
      out.push(`![](baram-asset:${name})`);
      idx++;
    } catch (err) {
      console.error("Mermaid export: render failed, keeping source", err);
      out.push(seg.open);
      if (code) out.push(...code.split("\n"));
      if (seg.close !== null) out.push(seg.close);
    }
  }

  return { assets, markdown: out.join("\n") };
}

/** Default renderer: Mermaid source → SVG (SVG text labels) → 2x PNG bytes. */
async function defaultRenderer(code: string): Promise<number[]> {
  const svg = await renderMermaidRasterSvg(code);
  const blob = await svgToPngBlob(svg, 2);
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}
