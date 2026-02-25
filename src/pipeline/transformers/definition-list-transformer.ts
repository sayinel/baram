// definition-list-transformer.ts — Definition List mdast ↔ ProseMirror
// Markdown: Term\n: Definition
// remark-parse produces paragraphs — detection is in md-to-pm.ts.
// This transformer is a placeholder entry for the registry.
import type { Node as PmNode, Schema } from "@tiptap/pm/model";
import type { Node as MdastNode } from "mdast";
import type { NodeTransformerEntry } from "../types";
import type { PhrasingContent, Text } from "mdast";

/** Regex to detect definition line prefix `: ` */
export const DEFINITION_PREFIX_RE = /^:\s/;

/** Check if text starts with definition prefix */
export function isDefinitionLine(text: string): boolean {
  return DEFINITION_PREFIX_RE.test(text);
}

/** Strip `: ` prefix from the first text child of a PhrasingContent array.
 *  Returns a new array with the prefix stripped. */
export function stripDefinitionPrefix(
  children: PhrasingContent[],
): PhrasingContent[] {
  if (children.length === 0) return children;

  const first = children[0];
  if (first.type === "text") {
    const text = (first as Text).value;
    if (DEFINITION_PREFIX_RE.test(text)) {
      const stripped = text.replace(DEFINITION_PREFIX_RE, "");
      if (stripped) {
        return [
          { type: "text", value: stripped } as Text,
          ...children.slice(1),
        ];
      }
      // If stripping leaves empty, skip the text node
      return children.slice(1);
    }
  }

  return children;
}

export const definitionListTransformer: NodeTransformerEntry = {
  // Virtual mdast type — remark produces paragraphs, detection in md-to-pm.ts
  mdastType: "definitionList",
  pmType: "definitionList",

  mdastToPm(_node: MdastNode, _schema: Schema, _convertChildren) {
    // Actual conversion is handled directly in md-to-pm.ts tryConvertDefinitionList()
    return null;
  },

  pmToMdast(_node: PmNode, _convertChildren): MdastNode {
    // Actual serialization is handled directly in pm-to-md.ts
    return null as unknown as MdastNode;
  },
};
