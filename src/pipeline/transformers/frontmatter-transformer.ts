// frontmatter-transformer.ts — §5.8 YAML Frontmatter mdast ↔ ProseMirror
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode } from "mdast";
import type { NodeTransformerEntry } from "../types";

interface MdastYaml extends MdastNode {
  type: "yaml";
  value: string;
}

export const frontmatterTransformer: NodeTransformerEntry = {
  mdastType: "yaml",
  pmType: "frontmatter",

  mdastToPm(node: MdastNode, schema: Schema) {
    const yaml = node as MdastYaml;
    return schema.nodes.frontmatter.create(
      { yaml: yaml.value || "" },
      yaml.value ? [schema.text(yaml.value)] : [],
    );
  },

  pmToMdast(node: PmNode): MdastNode {
    return {
      type: "yaml",
      value: node.textContent || (node.attrs.yaml as string) || "",
    } as MdastYaml;
  },
};
