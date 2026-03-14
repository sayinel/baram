// §5.1 Horizontal Rule Extension
import { InputRule, mergeAttributes, Node } from "@tiptap/core";

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
                const { $to } = tr.selection;
                const posAfter = $to.end();
                if ($to.nodeAfter) {
                  tr.setSelection(
                    // @ts-expect-error TextSelection available at runtime
                    tr.selection.constructor.near(tr.doc.resolve(posAfter)),
                  );
                } else {
                  const node =
                    $to.parent.type.contentMatch.defaultType?.create();
                  if (node) {
                    tr.insert(posAfter, node);
                    tr.setSelection(
                      // @ts-expect-error TextSelection available at runtime
                      tr.selection.constructor.near(
                        tr.doc.resolve(posAfter + 1),
                      ),
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
