// code-block-transformer.ts — Code Block mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode, Code } from "mdast";
import type { NodeTransformerEntry } from "../types";

export const codeBlockTransformer: NodeTransformerEntry = {
  mdastType: "code",
  pmType: "codeBlock",

  mdastToPm(node: MdastNode, schema: Schema) {
    const code = node as Code;
    return schema.nodes.codeBlock.create(
      { language: code.lang || null },
      code.value ? schema.text(code.value) : undefined,
    );
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "code",
      lang: (node.attrs.language as string) || undefined,
      value: node.textContent,
    } as Code;
  },
};
