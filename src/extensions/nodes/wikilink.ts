// §28 Wikilink Node Extension — [[page]], [[page|display]], [[page#heading]]
// Stub — to be implemented in Step 3

import { Node } from "@tiptap/core";

export const Wikilink = Node.create({
  name: "wikilink",
  group: "inline",
  inline: true,
  atom: true,
  marks: "",

  addAttributes() {
    return {
      target: { default: "" },
      display: { default: null },
      heading: { default: null },
      blockId: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-type="wikilink"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      { ...HTMLAttributes, "data-type": "wikilink", class: "wikilink" },
      HTMLAttributes.display || HTMLAttributes.target || "",
    ];
  },
});
