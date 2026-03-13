// §43 Ghost Text — ProseMirror Plugin for inline completion suggestions
// Shows ghost text (dimmed, italic) at cursor position.
// Accepts: Tab (full), Cmd+Right (word), Escape (dismiss).
// Dismissed on any edit or selection change.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const ghostTextPluginKey = new PluginKey("ghostText");

export interface GhostTextState {
  pos: number;
  text: null | string;
}

export const GhostText = Extension.create({
  name: "ghostText",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: ghostTextPluginKey,
        state: {
          init(): GhostTextState {
            return { text: null, pos: 0 };
          },
          apply(tr, prev): GhostTextState {
            const meta = tr.getMeta(ghostTextPluginKey);
            if (meta !== undefined) return meta;
            // Dismiss on any doc change or selection change
            if (tr.docChanged || tr.selectionSet) {
              return { text: null, pos: 0 };
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            const pluginState = ghostTextPluginKey.getState(
              state,
            ) as GhostTextState;
            if (!pluginState.text) return DecorationSet.empty;

            const { text, pos } = pluginState;
            // Validate position is within document bounds
            if (pos < 0 || pos > state.doc.content.size)
              return DecorationSet.empty;

            const widget = Decoration.widget(
              pos,
              () => {
                const span = document.createElement("span");
                span.className = "ghost-text";
                span.textContent = text;
                return span;
              },
              { side: 1 },
            );

            return DecorationSet.create(state.doc, [widget]);
          },
          handleKeyDown(view, event) {
            const ghostState = ghostTextPluginKey.getState(
              view.state,
            ) as GhostTextState;
            if (!ghostState.text) return false;

            // Tab: accept full suggestion
            if (event.key === "Tab") {
              event.preventDefault();
              const { text, pos } = ghostState;
              // Insert the text and clear ghost in one transaction
              const tr = view.state.tr
                .insertText(text!, pos)
                .setMeta(ghostTextPluginKey, { text: null, pos: 0 });
              view.dispatch(tr);
              return true;
            }

            // Cmd+Right (macOS) / Ctrl+Right (other): accept first word
            if (
              (event.metaKey || event.ctrlKey) &&
              event.key === "ArrowRight"
            ) {
              event.preventDefault();
              const { text, pos } = ghostState;
              const firstWord = text!.match(/^\S+\s?/)?.[0] ?? text!;
              const remaining = text!.slice(firstWord.length) || null;
              const newPos = pos + firstWord.length;

              const tr = view.state.tr.insertText(firstWord, pos);
              if (remaining) {
                tr.setMeta(ghostTextPluginKey, {
                  text: remaining,
                  pos: newPos,
                });
              } else {
                tr.setMeta(ghostTextPluginKey, { text: null, pos: 0 });
              }
              view.dispatch(tr);
              return true;
            }

            // Escape: dismiss
            if (event.key === "Escape") {
              event.preventDefault();
              view.dispatch(
                view.state.tr.setMeta(ghostTextPluginKey, {
                  text: null,
                  pos: 0,
                }),
              );
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
