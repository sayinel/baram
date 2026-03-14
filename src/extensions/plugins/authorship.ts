// §11.7 Authorship ProseMirror Plugin — decorations for AI-authored segments

import type { AuthorshipTracker } from "../../utils/authorship-tracker";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const authorshipPluginKey = new PluginKey("authorship");

/**
 * Build a DecorationSet from the tracker's segments.
 * Returns empty when isEnabled is false.
 */
export function buildAuthorshipDecorations(
  doc: ProseMirrorNode,
  tracker: AuthorshipTracker,
  isEnabled: boolean,
): DecorationSet {
  if (!isEnabled) {
    return DecorationSet.empty;
  }

  const segments = tracker.getSegments();
  const decorations: Decoration[] = [];

  for (const seg of segments) {
    if (seg.origin === "human") continue;

    const cssClass =
      seg.origin === "ai-generated"
        ? "authorship-ai-generated"
        : "authorship-ai-modified";

    // Clamp positions to doc bounds
    const from = Math.max(0, seg.from);
    const to = Math.min(doc.content.size, seg.to);

    if (from < to) {
      decorations.push(Decoration.inline(from, to, { class: cssClass }));
    }
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Tiptap Extension wrapper for the Authorship plugin.
 * Requires external state (tracker + isEnabled) to be set via plugin meta.
 */
export const Authorship = Extension.create({
  name: "authorship",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: authorshipPluginKey,

        props: {
          decorations(state) {
            const meta = authorshipPluginKey.getState(state) as
              | undefined
              | {
                  isEnabled: boolean;
                  tracker: AuthorshipTracker;
                };

            if (!meta?.tracker) return DecorationSet.empty;

            return buildAuthorshipDecorations(
              state.doc,
              meta.tracker,
              meta.isEnabled,
            );
          },
        },

        state: {
          apply(tr, prev) {
            const meta = tr.getMeta(authorshipPluginKey);
            if (meta !== undefined) return meta;
            return prev;
          },
          init() {
            return { isEnabled: false, tracker: null };
          },
        },
      }),
    ];
  },
});
