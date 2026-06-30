import type { NodeTransformerEntry } from "../types";
// mermaid-block-transformer.ts — §5.5 Mermaid Block mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Code, Node as MdastNode } from "mdast";

import {
  parseMermaidMeta,
  setMermaidMeta,
  stripMermaidMeta,
} from "../../utils/markdown/mermaid-meta";

export const mermaidBlockTransformer: NodeTransformerEntry = {
  // Uses a synthetic mdast type for Map registration; actual routing is in md-to-pm.ts
  mdastType: "mermaid",
  pmType: "mermaidBlock",

  mdastToPm(node: MdastNode, schema: Schema) {
    const raw = (node as Code).value || "";
    // Width/caption live in a `%% baram-meta` comment; split them out so the
    // `code` attr is a pure diagram and the editor textarea stays clean.
    const meta = parseMermaidMeta(raw);
    return schema.nodes.mermaidBlock.create({
      caption: meta.caption,
      code: stripMermaidMeta(raw),
      width: meta.width,
    });
  },

  pmToMdast(node: PmNode): MdastNode {
    // Re-attach width/caption as the `%% baram-meta` line (no-op when both null).
    const value = setMermaidMeta((node.attrs.code as string) || "", {
      caption: (node.attrs.caption as null | string) ?? null,
      width: (node.attrs.width as null | number) ?? null,
    });
    return { type: "code", lang: "mermaid", value } as Code;
  },
};
