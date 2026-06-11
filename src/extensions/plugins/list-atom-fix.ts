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

import { changedRanges } from "../../utils/editor/changed-ranges";
import { PROGRESSIVE_LOAD_META } from "../../utils/editor/progressive-load";

export const listAtomFixKey = new PluginKey<DecorationSet>("listAtomFix");

function buildListAtomDecos(
  doc: Parameters<typeof DecorationSet.create>[0],
): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos, parent, index) => {
    if (
      node.isTextblock &&
      index === 0 &&
      parent &&
      (parent.type.name === "listItem" || parent.type.name === "taskItem") &&
      node.childCount > 0 &&
      !node.child(0).isText
    ) {
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
}

export const ListAtomFix = Extension.create({
  name: "listAtomFix",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: listAtomFixKey,
        state: {
          init() {
            // §perf-large-file: Defer initial build to first transaction
            return DecorationSet.empty;
          },
          apply(tr, old, _oldState, newState) {
            // Deferred init: first real doc → full build
            if (old === DecorationSet.empty && newState.doc.content.size > 0) {
              return buildListAtomDecos(newState.doc);
            }
            // Progressive-load chunks or no doc change → fast map only
            if (!tr.docChanged || tr.getMeta(PROGRESSIVE_LOAD_META) === true) {
              return old.map(tr.mapping, tr.doc);
            }
            // §perf-large-file C3.1: incremental update over changed ranges
            let decos = old.map(tr.mapping, tr.doc);
            const ranges = changedRanges(tr);
            for (const range of ranges) {
              // Expand range to enclosing listItem/taskItem boundary so a partial
              // edit within an item re-evaluates the whole item.
              let from = range.from;
              let to = range.to;
              const $from = newState.doc.resolve(Math.max(0, from));
              for (let d = $from.depth; d >= 1; d--) {
                const ancestor = $from.node(d);
                if (
                  ancestor.type.name === "listItem" ||
                  ancestor.type.name === "taskItem"
                ) {
                  from = $from.before(d);
                  to = Math.max(to, from + ancestor.nodeSize);
                  break;
                }
              }
              // Clamp to doc bounds
              from = Math.max(0, from);
              to = Math.min(newState.doc.content.size, to);

              // Remove stale decorations in this range and re-collect
              const stale = decos.find(from, to);
              if (stale.length > 0) decos = decos.remove(stale);

              const fresh: Decoration[] = [];
              newState.doc.nodesBetween(
                from,
                to,
                (node, pos, parent, index) => {
                  if (
                    node.isTextblock &&
                    index === 0 &&
                    parent &&
                    (parent.type.name === "listItem" ||
                      parent.type.name === "taskItem") &&
                    node.childCount > 0 &&
                    !node.child(0).isText
                  ) {
                    const paraContentStart = pos + 1;
                    fresh.push(
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
                },
              );
              if (fresh.length > 0) decos = decos.add(newState.doc, fresh);
            }
            return decos;
          },
        },
        props: {
          decorations(state) {
            return listAtomFixKey.getState(state) as DecorationSet;
          },
        },
      }),
    ];
  },
});
