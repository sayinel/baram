import type { MarkTransformerEntry } from "../types";
// link-transformer.ts — §5.1 Link mark mdast ↔ ProseMirror
import type { Mark } from "@tiptap/pm/model";
import type { Schema } from "@tiptap/pm/model";
import type { Link, Node as MdastNode, PhrasingContent } from "mdast";

export const linkTransformer: MarkTransformerEntry = {
  mdastType: "link",
  pmMarkType: "link",

  mdastToMark(node: MdastNode, schema: Schema) {
    const link = node as Link;
    return schema.marks.link.create({
      href: link.url,
      title: link.title || null,
    });
  },

  markToMdast(mark: Mark, children: MdastNode[]): MdastNode {
    return {
      type: "link",
      url: mark.attrs.href as string,
      title: (mark.attrs.title as string) || null,
      children: children as PhrasingContent[],
    } as Link;
  },
};
