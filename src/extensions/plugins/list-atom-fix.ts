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

// ── State ─────────────────────────────────────────────────────────────

interface ListAtomFixState {
  decorations: DecorationSet;
  /**
   * True after the first full build has run. Prevents re-running the full
   * doc walk on every transaction for docs that have zero qualifying items
   * (DecorationSet.create(doc,[]) returns the shared empty instance so
   * `decos === DecorationSet.empty` can't be used as an init sentinel).
   */
  initialized: boolean;
  /**
   * Set to true by every progressive-load (gated) transaction. The next
   * non-gated docChanged performs a full rebuild to honour the C2 contract.
   */
  needsFullRebuild: boolean;
}

export const listAtomFixKey = new PluginKey<ListAtomFixState>("listAtomFix");

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
          init(): ListAtomFixState {
            // §perf-large-file: Defer initial build to first transaction.
            return {
              decorations: DecorationSet.empty,
              initialized: false,
              needsFullRebuild: false,
            };
          },

          apply(tr, old, _oldState, newState): ListAtomFixState {
            // Deferred init: first transaction after doc is populated.
            if (!old.initialized && newState.doc.content.size > 0) {
              return {
                decorations: buildListAtomDecos(newState.doc),
                initialized: true,
                needsFullRebuild: false,
              };
            }

            // No doc change (or empty doc still) → fast map only.
            if (!tr.docChanged) {
              return {
                decorations: old.decorations.map(tr.mapping, tr.doc),
                initialized: old.initialized,
                needsFullRebuild: old.needsFullRebuild,
              };
            }

            // Progressive-load (gated) chunk: map positions, set flag.
            if (tr.getMeta(PROGRESSIVE_LOAD_META) === true) {
              return {
                decorations: old.decorations.map(tr.mapping, tr.doc),
                initialized: old.initialized,
                needsFullRebuild: true,
              };
            }

            // First non-gated docChanged after progressive load → full rebuild.
            if (old.needsFullRebuild) {
              return {
                decorations: buildListAtomDecos(newState.doc),
                initialized: true,
                needsFullRebuild: false,
              };
            }

            // §perf-large-file C3.1: incremental update over changed ranges.
            let decos = old.decorations.map(tr.mapping, tr.doc);
            const ranges = changedRanges(tr);
            for (const range of ranges) {
              // Expand range to enclosing listItem/taskItem boundary so a
              // partial edit within an item re-evaluates the whole item.
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
              // Clamp to doc bounds.
              from = Math.max(0, from);
              to = Math.min(newState.doc.content.size, to);

              // Remove stale decorations in this range and re-collect.
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
            return {
              decorations: decos,
              initialized: true,
              needsFullRebuild: false,
            };
          },
        },
        props: {
          decorations(state) {
            return (
              listAtomFixKey.getState(state)?.decorations ?? DecorationSet.empty
            );
          },
        },
      }),
    ];
  },
});
