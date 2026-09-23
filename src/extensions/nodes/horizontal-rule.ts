// §5.1 Horizontal Rule Extension
import { InputRule, mergeAttributes, Node } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";

import { htmlAttributesOptions } from "../utils/html-attributes-options";

export interface HorizontalRuleOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    horizontalRule: {
      setHorizontalRule: () => ReturnType;
    };
  }
}

export const HorizontalRule = Node.create<HorizontalRuleOptions>({
  name: "horizontalRule",
  group: "block",
  atom: true,

  ...htmlAttributesOptions,

  parseHTML() {
    return [{ tag: "hr" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["hr", mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addCommands() {
    return {
      setHorizontalRule:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name })
            .command(({ tr, dispatch }) => {
              if (dispatch) {
                // The selection now sits right after the rule, between blocks.
                const { $to } = tr.selection;
                const posAfter = $to.end();
                if ($to.nodeAfter) {
                  // ‼️ Search forward from the rule, not from `posAfter`. That
                  // is the end of the rule's PARENT — the whole document when
                  // the rule is top-level — so the caret used to land on the
                  // document's last line, or leave the blockquote it was in.
                  tr.setSelection(Selection.near($to, 1));
                } else {
                  const node =
                    $to.parent.type.contentMatch.defaultType?.create();
                  if (node) {
                    tr.insert(posAfter, node);
                    tr.setSelection(
                      Selection.near(tr.doc.resolve(posAfter + 1)),
                    );
                  }
                }
                tr.scrollIntoView();
              }
              return true;
            })
            .run(),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^(?:---|\*\*\*|___)\s?$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).setHorizontalRule().run();
        },
      }),
    ];
  },
});
