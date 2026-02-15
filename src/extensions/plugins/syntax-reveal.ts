// §5.1 Syntax Reveal — Typora-style focus-based syntax exposure
// Shows markdown syntax (## , **, *, etc.) when cursor is inside the element,
// hides when cursor moves away.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PmNode, Mark } from "@tiptap/pm/model";

const syntaxRevealKey = new PluginKey<DecorationSet>("syntaxReveal");

// Mark delimiter definitions
const MARK_DELIMITERS: Record<string, { open: string; close: string | ((mark: Mark) => string) }> = {
  bold: { open: "**", close: "**" },
  italic: { open: "*", close: "*" },
  strike: { open: "~~", close: "~~" },
  code: { open: "`", close: "`" },
  underline: { open: "<u>", close: "</u>" },
};

/** Create a DOM element for a syntax delimiter widget */
function delimiterWidget(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = "syntax-delimiter";
  span.textContent = text;
  return span;
}

/**
 * Find the range of a specific mark around the cursor position within a textblock.
 * Returns {from, to} in document positions, or null if the cursor is not inside this mark.
 */
function findMarkRange(
  parentNode: PmNode,
  parentPos: number, // position before the first child
  markType: string,
  cursorPos: number,
): { from: number; to: number } | null {
  // Collect ranges of this mark type within the parent
  const ranges: { from: number; to: number }[] = [];

  parentNode.forEach((child, childOffset) => {
    const childFrom = parentPos + childOffset;
    const childTo = childFrom + child.nodeSize;
    const hasMark = child.marks.some((m) => m.type.name === markType);

    if (hasMark) {
      // Extend the last range if adjacent
      const last = ranges[ranges.length - 1];
      if (last && last.to === childFrom) {
        last.to = childTo;
      } else {
        ranges.push({ from: childFrom, to: childTo });
      }
    }
  });

  // Find the range that contains the cursor
  for (const range of ranges) {
    if (cursorPos >= range.from && cursorPos <= range.to) {
      return range;
    }
  }

  return null;
}

/** Build decorations based on cursor position */
function buildDecorations(state: EditorState): DecorationSet {
  const { selection } = state;
  const $pos = selection.$from;
  const parentNode = $pos.parent;
  const decorations: Decoration[] = [];

  if (!parentNode.isTextblock) {
    return DecorationSet.empty;
  }

  // Get the start position of the parent node's content
  const parentPos = $pos.before($pos.depth) + 1;

  // ── Heading syntax reveal ──
  if (parentNode.type.name === "heading") {
    const level = parentNode.attrs.level as number;
    const nodeFrom = $pos.before($pos.depth);
    const nodeTo = nodeFrom + parentNode.nodeSize;
    decorations.push(
      Decoration.node(nodeFrom, nodeTo, {
        class: `syntax-visible syntax-heading-${level}`,
      }),
    );
  }

  // ── Mark syntax reveal ──
  // Get marks at cursor position
  const cursorPos = selection.from;
  const marksAtCursor = $pos.marks();

  for (const mark of marksAtCursor) {
    const delim = MARK_DELIMITERS[mark.type.name];
    if (!delim) continue;

    const range = findMarkRange(parentNode, parentPos, mark.type.name, cursorPos);
    if (!range) continue;

    const closeText = typeof delim.close === "function" ? delim.close(mark) : delim.close;

    decorations.push(
      Decoration.widget(range.from, () => delimiterWidget(delim.open), {
        side: -1,
        key: `${mark.type.name}-open-${range.from}`,
      }),
    );
    decorations.push(
      Decoration.widget(range.to, () => delimiterWidget(closeText), {
        side: 1,
        key: `${mark.type.name}-close-${range.to}`,
      }),
    );
  }

  // ── Link syntax reveal (special: shows [text](url)) ──
  const linkMark = marksAtCursor.find((m) => m.type.name === "link");
  if (linkMark) {
    const range = findMarkRange(parentNode, parentPos, "link", cursorPos);
    if (range) {
      const href = linkMark.attrs.href as string;
      const title = linkMark.attrs.title as string | null;
      const closeSuffix = title ? `](${href} "${title}")` : `](${href})`;

      decorations.push(
        Decoration.widget(range.from, () => delimiterWidget("["), {
          side: -1,
          key: `link-open-${range.from}`,
        }),
      );
      decorations.push(
        Decoration.widget(range.to, () => delimiterWidget(closeSuffix), {
          side: 1,
          key: `link-close-${range.to}`,
        }),
      );
    }
  }

  return DecorationSet.create(state.doc, decorations);
}

/** Create the syntax reveal ProseMirror plugin */
function createSyntaxRevealPlugin(): Plugin {
  return new Plugin({
    key: syntaxRevealKey,

    state: {
      init(_, state) {
        return buildDecorations(state);
      },
      apply(tr, oldDecorations, _oldState, newState) {
        // Only rebuild if selection changed or doc changed
        if (tr.selectionSet || tr.docChanged) {
          return buildDecorations(newState);
        }
        return oldDecorations;
      },
    },

    props: {
      decorations(state) {
        return syntaxRevealKey.getState(state);
      },
    },
  });
}

/** Tiptap Extension wrapper */
export const SyntaxReveal = Extension.create({
  name: "syntaxReveal",

  addProseMirrorPlugins() {
    return [createSyntaxRevealPlugin()];
  },
});
