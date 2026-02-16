// §5.1 + §3.3 Syntax Reveal — Typora-style focus-based syntax exposure
// When cursor is inside a textblock, shows markdown syntax (## , **, *, etc.)
// as inline widget decorations alongside the rendered content.
// The rendered appearance is preserved — syntax markers appear in light gray.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PmNode, Mark } from "@tiptap/pm/model";

const syntaxRevealKey = new PluginKey<DecorationSet>("syntaxReveal");

// Mark delimiter definitions
const MARK_DELIMITERS: Record<
  string,
  { open: string; close: string | ((mark: Mark) => string) }
> = {
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
 * Collect ALL mark ranges in a textblock (not just at cursor).
 * Returns ranges grouped by mark type name.
 */
function collectAllMarkRanges(
  parentNode: PmNode,
  parentPos: number,
): Map<string, { from: number; to: number; mark: Mark }[]> {
  const markRanges = new Map<
    string,
    { from: number; to: number; mark: Mark }[]
  >();

  parentNode.forEach((child, childOffset) => {
    const childFrom = parentPos + childOffset;
    const childTo = childFrom + child.nodeSize;

    for (const mark of child.marks) {
      const typeName = mark.type.name;
      if (!MARK_DELIMITERS[typeName] && typeName !== "link") continue;

      let ranges = markRanges.get(typeName);
      if (!ranges) {
        ranges = [];
        markRanges.set(typeName, ranges);
      }

      // Extend last range if adjacent and same mark attrs
      const last = ranges[ranges.length - 1];
      if (
        last &&
        last.to === childFrom &&
        marksEqual(last.mark, mark)
      ) {
        last.to = childTo;
      } else {
        ranges.push({ from: childFrom, to: childTo, mark });
      }
    }
  });

  return markRanges;
}

/** Check if two marks have the same type and attrs */
function marksEqual(a: Mark, b: Mark): boolean {
  if (a.type.name !== b.type.name) return false;
  return JSON.stringify(a.attrs) === JSON.stringify(b.attrs);
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

  // ── Mark syntax reveal — show delimiters for ALL marks in this block ──
  const allMarkRanges = collectAllMarkRanges(parentNode, parentPos);

  for (const [typeName, ranges] of allMarkRanges) {
    if (typeName === "link") {
      // Link handled separately below
      continue;
    }

    const delim = MARK_DELIMITERS[typeName];
    if (!delim) continue;

    for (const range of ranges) {
      const closeText =
        typeof delim.close === "function"
          ? delim.close(range.mark)
          : delim.close;

      decorations.push(
        Decoration.widget(range.from, () => delimiterWidget(delim.open), {
          side: -1,
          key: `${typeName}-open-${range.from}`,
        }),
      );
      decorations.push(
        Decoration.widget(range.to, () => delimiterWidget(closeText), {
          side: 1,
          key: `${typeName}-close-${range.to}`,
        }),
      );
    }
  }

  // ── Link syntax reveal ──
  const linkRanges = allMarkRanges.get("link");
  if (linkRanges) {
    for (const range of linkRanges) {
      const href = range.mark.attrs.href as string;
      const title = range.mark.attrs.title as string | null;
      const closeSuffix = title
        ? `](${href} "${title}")`
        : `](${href})`;

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
