// §56m List atom fix — WebKit list marker alignment for atom-only paragraphs
//
// WebKit's ::marker aligns with the first "editable" line box in a list item.
// When a <li>'s first <p> contains only contenteditable="false" inline atoms
// (e.g. tagNode), there's no editable line box, causing the marker to drop
// to the next block (e.g. a nested sub-list).
//
// This plugin inserts a zero-width space widget decoration at the start of
// such paragraphs, creating an editable first line box for marker alignment.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const pluginKey = new PluginKey("listAtomFix");

export const ListAtomFix = Extension.create({
  name: "listAtomFix",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        props: {
          decorations(state) {
            const { doc } = state;
            const decorations: Decoration[] = [];

            doc.descendants((node, pos, parent, index) => {
              // Find paragraphs that are the first child of a list/task item
              // and whose first content node is NOT text (i.e. an atom).
              if (
                node.isTextblock &&
                index === 0 &&
                parent &&
                (parent.type.name === "listItem" ||
                  parent.type.name === "taskItem") &&
                node.childCount > 0 &&
                !node.child(0).isText
              ) {
                // Insert zero-width space widget right after the <p> opening
                const paraContentStart = pos + 1;
                decorations.push(
                  Decoration.widget(
                    paraContentStart,
                    () => {
                      const span = document.createElement("span");
                      span.textContent = "\u200B";
                      span.className = "list-atom-fix";
                      return span;
                    },
                    { side: -1, key: `laf-${pos}` },
                  ),
                );
              }
              return true;
            });

            return DecorationSet.create(doc, decorations);
          },
        },
      }),
    ];
  },
});
