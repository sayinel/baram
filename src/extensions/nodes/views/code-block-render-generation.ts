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

import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";

import { Plugin, PluginKey } from "@tiptap/pm/state";
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
