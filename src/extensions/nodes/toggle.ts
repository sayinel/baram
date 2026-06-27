// §5.1 Toggle Extension — <details><summary> collapsible block
import type { Node as PmNode, ResolvedPos } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { mergeAttributes, Node } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

import { htmlAttributesOptions } from "../utils/html-attributes-options";
import { resolveShortcut } from "../utils/shortcut-resolver";

export interface ToggleOptions {
  HTMLAttributes: Record<string, string>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: (attrs?: {
        level?: number;
        open?: boolean;
        summaryType?: "heading";
      }) => ReturnType;
      toggleToggle: () => ReturnType;
      unsetToggle: () => ReturnType;
    };
  }
}

/** Find the nearest toggle ancestor depth, or -1 */
function findToggleDepth($from: ResolvedPos, name: string): number {
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === name) return d;
  }
  return -1;
}

/** Move cursor to after the toggle (next sibling or create paragraph) */
function moveAfterToggle(
  state: EditorState,
  view: EditorView,
  toggleDepth: number,
): boolean {
  const { $from } = state.selection;
  const toggleAfter = $from.after(toggleDepth);

  if (toggleAfter < state.doc.content.size) {
    const sel = TextSelection.findFrom(state.doc.resolve(toggleAfter), 1);
    if (sel) {
      const { tr } = state;
      tr.setSelection(sel);
      view.dispatch(tr);
      return true;
    }
  }

  // No block after toggle → create paragraph
  const { tr } = state;
  const para = state.schema.nodes.paragraph.create();
  tr.insert(toggleAfter, para);
  tr.setSelection(TextSelection.create(tr.doc, toggleAfter + 1));
  view.dispatch(tr);
  return true;
}

export const Toggle = Node.create<ToggleOptions>({
  name: "toggle",
  group: "block",
  content: "(paragraph | heading) block*",
  defining: true,

  ...htmlAttributesOptions,

  addAttributes() {
    return {
      open: { default: true },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="toggle"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-type": "toggle",
        "data-open": node.attrs.open ? "true" : "false",
        class: "toggle",
      }),
      0,
    ];
  },

  // Rendered natively via renderHTML (NOT a React NodeView): the arrow is a CSS
  // ::before on the PM-rendered `.toggle` element, the same proven mechanism as
  // the heading fold arrow (`.tiptap > hN::before`). A React NodeView's arrow
  // (svg/glyph/::before inside the contentEditable=false subtree) never painted
  // on initial mount in WKWebView — only a global style recalc revived it — so
  // the toggle is kept out of the React NodeView system entirely.
  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey("toggleGutterClick"),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target;
              // Only a direct click on the toggle's own box — its left padding
              // column or the ::before arrow (a pseudo-element, so its clicks
              // forward to the host `.toggle`) — toggles. Clicks on a child block
              // (summary/body) report that child as the target and fall through
              // to normal cursor placement. Matching the element needs no
              // coordinate math, so it is zoom-safe (offsetX magnitude under CSS
              // zoom is unreliable — cf. [[wkwebview-css-zoom-coords]]).
              if (
                !(target instanceof HTMLElement) ||
                !target.matches('div[data-type="toggle"]') ||
                !view.dom.contains(target)
              ) {
                return false;
              }
              const toggleEl = target;

              let pos: null | number = null;
              let node: null | PmNode = null;
              try {
                const rawPos = view.posAtDOM(toggleEl, 0);
                const $resolved = view.state.doc.resolve(rawPos);
                for (let d = $resolved.depth; d >= 0; d--) {
                  if ($resolved.node(d).type === type) {
                    node = $resolved.node(d);
                    pos = d > 0 ? $resolved.before(d) : 0;
                    break;
                  }
                }
              } catch {
                return false;
              }
              if (pos === null || !node) return false;

              event.preventDefault();
              event.stopPropagation();
              const tr = view.state.tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                open: !node.attrs.open,
              });
              view.dispatch(tr);
              return true;
            },
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      setToggle:
        (attrs) =>
        ({ commands }) => {
          const isHeading = attrs?.summaryType === "heading";
          const summaryContent = isHeading
            ? {
                type: "heading" as const,
                attrs: { level: attrs?.level ?? 2 },
              }
            : { type: "paragraph" as const };
          return commands.insertContent({
            type: this.name,
            attrs: { open: attrs?.open ?? true },
            content: [summaryContent],
          });
        },
      toggleToggle:
        () =>
        ({ state, commands }) => {
          const { $from } = state.selection;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === this.name) {
              return commands.lift(this.name);
            }
          }
          return commands.insertContent({
            type: this.name,
            attrs: { open: true },
            content: [{ type: "paragraph" }],
          });
        },
      unsetToggle:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        const toggleDepth = findToggleDepth($from, this.name);
        if (toggleDepth < 0) return false;

        const toggleNode = $from.node(toggleDepth);
        const childIndex = $from.index(toggleDepth);
        const parentNode = $from.parent;
        const isOpen = toggleNode.attrs.open as boolean;

        // === Summary (first child) ===
        if (childIndex === 0) {
          if (!isOpen) {
            // Collapsed: create new toggle sibling below
            // Text after cursor → new toggle's summary
            const { tr } = state;
            const afterContent = parentNode.content.cut($from.parentOffset);

            // Delete text after cursor from current summary
            if ($from.parentOffset < parentNode.content.size) {
              tr.delete($from.pos, $from.end());
            }

            // Insert new toggle after current toggle
            const toggleAfterPos = tr.mapping.map($from.after(toggleDepth));

            // Preserve summary type: if heading, new sibling gets same heading level
            let newSummary;
            if (parentNode.type.name === "heading") {
              newSummary = state.schema.nodes.heading.create(
                { level: parentNode.attrs.level },
                afterContent.size > 0 ? afterContent : undefined,
              );
            } else {
              newSummary = state.schema.nodes.paragraph.create(
                null,
                afterContent.size > 0 ? afterContent : undefined,
              );
            }
            const newToggle = state.schema.nodes.toggle.create(
              { open: false },
              [newSummary],
            );
            tr.insert(toggleAfterPos, newToggle);
            // Cursor at start of new toggle's summary (+1 toggle open, +1 summary open)
            tr.setSelection(TextSelection.create(tr.doc, toggleAfterPos + 2));

            view.dispatch(tr);
            return true;
          }

          // Expanded: let default ProseMirror splitBlock handle it
          // (creates new paragraph inside toggle as second child)
          return false;
        }

        // === Body (not summary): exit on empty last child ===
        const isLastChild = childIndex === toggleNode.childCount - 1;
        if (!isLastChild) return false;
        if (parentNode.content.size !== 0) return false;

        // Delete empty paragraph, create paragraph after toggle
        const { tr } = state;
        const emptyParaStart = $from.before($from.depth);
        const emptyParaEnd = $from.after($from.depth);
        tr.delete(emptyParaStart, emptyParaEnd);

        const toggleAfter = $from.after(toggleDepth);
        const mappedEnd = tr.mapping.map(toggleAfter);
        const para = state.schema.nodes.paragraph.create();
        tr.insert(mappedEnd, para);
        tr.setSelection(TextSelection.create(tr.doc, mappedEnd + 1));

        view.dispatch(tr);
        return true;
      },

      // Backspace:
      //  • at the start of a toggle summary → unwrap the toggle (Case A)
      //  • at the start of an empty top-level block right after a toggle → drop
      //    the empty block and move into the toggle's visible end (Case B)
      Backspace: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        const toggleDepth = findToggleDepth($from, this.name);

        // Case A: inside a toggle, at the start of its summary → unwrap (children
        // become siblings).
        if (toggleDepth >= 0) {
          const childIndex = $from.index(toggleDepth);
          if (childIndex !== 0 || $from.parentOffset !== 0) return false;

          const toggleNode = $from.node(toggleDepth);
          const toggleStart = $from.before(toggleDepth);
          const toggleEnd = $from.after(toggleDepth);
          const { tr } = state;
          tr.replaceWith(toggleStart, toggleEnd, toggleNode.content);
          tr.setSelection(TextSelection.create(tr.doc, toggleStart + 1));
          view.dispatch(tr);
          return true;
        }

        // Case B: at the start of an empty top-level block whose previous sibling
        // is a toggle. Default Backspace would merge into the toggle's last child
        // — which is HIDDEN when the toggle is collapsed. Instead, delete the
        // empty block and place the cursor at the toggle's visible end: the end of
        // the summary when collapsed, or the end of the last body block when open.
        if ($from.depth !== 1 || $from.parentOffset !== 0) return false;
        if ($from.parent.content.size !== 0) return false;

        const topIndex = $from.index(0);
        if (topIndex === 0) return false;
        const prevToggle = state.doc.child(topIndex - 1);
        if (prevToggle.type !== this.type) return false;

        const emptyStart = $from.before(1);
        const toggleStart = emptyStart - prevToggle.nodeSize;
        const isOpen = prevToggle.attrs.open as boolean;
        const summary = prevToggle.firstChild;
        const targetPos = isOpen
          ? emptyStart - 2 // end of the toggle's last child's content
          : toggleStart + 2 + (summary ? summary.content.size : 0); // summary end

        const { tr } = state;
        tr.delete(emptyStart, emptyStart + $from.parent.nodeSize);
        tr.setSelection(TextSelection.near(tr.doc.resolve(targetPos), -1));
        view.dispatch(tr);
        return true;
      },

      // ArrowDown: collapsed summary → skip to next sibling; last body child → exit
      ArrowDown: () => {
        const { state, view } = this.editor;
        const { $from, empty } = state.selection;
        if (!empty) return false;

        const toggleDepth = findToggleDepth($from, this.name);
        if (toggleDepth < 0) return false;

        const toggleNode = $from.node(toggleDepth);
        const childIndex = $from.index(toggleDepth);
        const isOpen = toggleNode.attrs.open as boolean;
        const atEnd = $from.parentOffset === $from.parent.content.size;

        // Collapsed summary: skip body, jump to next sibling
        if (childIndex === 0 && !isOpen && atEnd) {
          return moveAfterToggle(state, view, toggleDepth);
        }

        // Last body child at end: exit toggle
        const isLastChild = childIndex === toggleNode.childCount - 1;
        if (isLastChild && atEnd) {
          return moveAfterToggle(state, view, toggleDepth);
        }

        return false;
      },

      // Cmd+Enter: toggle open/close
      [resolveShortcut("formatting.toggleBlock", "Mod-Enter")]: () => {
        const { state, view } = this.editor;
        const { $from } = state.selection;

        const toggleDepth = findToggleDepth($from, this.name);
        if (toggleDepth < 0) return false;

        const toggleNode = $from.node(toggleDepth);
        const pos = $from.before(toggleDepth);
        const { tr } = state;
        tr.setNodeMarkup(pos, undefined, {
          ...toggleNode.attrs,
          open: !toggleNode.attrs.open,
        });
        view.dispatch(tr);
        return true;
      },
    };
  },
});
