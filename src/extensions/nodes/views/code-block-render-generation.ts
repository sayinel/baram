// §394 spec 0073 D6 — how a change in the code block renderer registry reaches the views. The
// schema is fixed, so a block whose language gains or loses a renderer must be REBUILT as the other
// view — and a NodeView is rebuilt when its `update` returns false. On each change this plugin puts
// a node decoration on every code block of a language that has a generation (one whose binding has
// changed at least once), carrying that generation in its SPEC; a changed outer decoration makes
// prosemirror-view 1.42.3 call the view's `update` (`CustomNodeViewDesc.update`), and node
// decorations compare attrs AND spec (`NodeType.eq`), so the generation alone reads as "changed"
// without touching the DOM. A block of a language that did not change this time gets a decoration
// equal to the one it had, which is no change; one it did not have (a block made since the last
// change) only asks its view's `update`, which keeps the view — its branch did not change. A block of
// a language that never changed gets none. Each of these keeps its view, CodeMirror or rendered.
//
// The generation moves only on a meta transaction, which `deliverCodeBlockRegistryChange` dispatches
// to every editor surface (`editor-surfaces.ts`) — a state field alone would never recompute in an
// editor no transaction reaches (a hidden keep-alive one). Between changes the set is mapped, not
// rebuilt: one keystroke costs a `DecorationSet.map`.
//
// The plugin also carries D17's click road into a rendered block's source (`handleClickOn`): a
// plain click on the output selects the block, and the view's `selectNode` opens source editing.
// On a plain click ProseMirror selects a node only when it is an atom (`selectClickedLeaf` in
// prosemirror-view 1.42.3; a Cmd-click on macOS, a Ctrl-click elsewhere, selects the clicked
// selectable node, atom or not — `selectClickedNode`), and a code block is not one. Nor does the
// DOM selection a click leaves in the block reach ProseMirror: the view ignores selection
// mutations, so that a drag-select of output text does not open the source.

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

import { NodeSelection, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { logger } from "../../../utils/logger";

interface GenerationMeta {
  langs: readonly string[];
}

interface GenerationState {
  decorations: DecorationSet;
  generations: ReadonlyMap<string, number>;
}

export const codeBlockRenderGenerationKey = new PluginKey<GenerationState>(
  "codeBlockRenderGeneration",
);

/** The plugin `CodeBlock` installs in every editor that has code blocks. */
export function codeBlockRenderGenerationPlugin(): Plugin<GenerationState> {
  return new Plugin<GenerationState>({
    key: codeBlockRenderGenerationKey,
    props: {
      decorations: (state) =>
        codeBlockRenderGenerationKey.getState(state)?.decorations,
      /**
       * D17 — select a rendered block on a click on the block itself (`direct`). ProseMirror ends
       * a click on `mouseup`, and not after a drag of more than 4 px or a shift-click
       * (`LeftMouseDown.up`), so a drag-select stays a selection of output text. A press on a
       * link, an action or the chrome never starts a click: the view's `stopEvent` keeps its
       * `mousedown` from ProseMirror. In source mode the view takes every event, and a block
       * CodeMirror draws does too (`CodeBlockNodeView.stopEvent`); the mode check below is for a
       * click that reaches here anyway.
       */
      handleClickOn(view, _pos, node, nodePos, _event, direct) {
        if (!direct || node.type.name !== "codeBlock") return false;
        const dom = view.nodeDOM(nodePos);
        if (
          !(dom instanceof HTMLElement) ||
          !dom.hasAttribute("data-plugin-block") ||
          dom.dataset.mode !== "rendered"
        ) {
          return false;
        }
        view.dispatch(
          view.state.tr.setSelection(
            NodeSelection.create(view.state.doc, nodePos),
          ),
        );
        return true;
      },
    },
    state: {
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(codeBlockRenderGenerationKey) as
          GenerationMeta | undefined;
        if (meta === undefined) {
          return tr.docChanged
            ? {
                ...value,
                decorations: value.decorations.map(tr.mapping, tr.doc),
              }
            : value;
        }
        const generations = new Map(value.generations);
        for (const lang of meta.langs) {
          generations.set(lang, (generations.get(lang) ?? 0) + 1);
        }
        return {
          decorations: decorate(newState.doc, generations),
          generations,
        };
      },
      init: () => ({
        decorations: DecorationSet.empty,
        generations: new Map(),
      }),
    },
  });
}

/**
 * Tell every editor in `editors` that `langs` changed. A meta transaction, kept out of undo
 * history. A destroyed editor is skipped; one whose dispatch throws costs only itself.
 */
export function deliverCodeBlockRegistryChange(
  editors: Iterable<Editor>,
  langs: readonly string[],
): void {
  for (const editor of editors) {
    if (editor.isDestroyed) continue;
    try {
      editor.view.dispatch(
        editor.state.tr
          .setMeta(codeBlockRenderGenerationKey, {
            langs,
          } satisfies GenerationMeta)
          .setMeta("addToHistory", false),
      );
    } catch (err) {
      logger.warn(
        "[CodeBlock] a renderer registry change did not reach an editor:",
        err,
      );
    }
  }
}

/** A node decoration on every code block whose language has a generation. */
function decorate(
  doc: PMNode,
  generations: ReadonlyMap<string, number>,
): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return true;
    const lang = (node.attrs.language as null | string) ?? "";
    const generation = generations.get(lang);
    if (generation !== undefined) {
      decorations.push(
        Decoration.node(
          pos,
          pos + node.nodeSize,
          {},
          {
            codeBlockRenderGeneration: `${lang}:${generation}`,
          },
        ),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}
