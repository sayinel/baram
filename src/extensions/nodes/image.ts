// §5.1 Image Extension (block-level) with §3.3 NodeView
import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ImageView } from "./image-view";
import { getSyntaxRevealExpanded } from "../plugins/syntax-reveal";

export interface ImageOptions {
  HTMLAttributes: Record<string, string>;
  allowBase64: boolean;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    image: {
      setImage: (options: {
        src: string;
        alt?: string;
        title?: string;
      }) => ReturnType;
    };
  }
}

export const Image = Node.create<ImageOptions>({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      allowBase64: false,
    };
  },

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      widthPercent: { default: 100 },
    };
  },

  parseHTML() {
    return [{ tag: "img[src]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "img",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },

  addCommands() {
    return {
      setImage:
        (options) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: options,
          }),
    };
  },

  addProseMirrorPlugins() {
    // §5.1 Fix: image click handling for trackpad (WebKit/Tauri)
    //
    // Problem: trackpad tap/click moves mouse >4px → PM allowDefault=true
    //   → selectClickedLeaf skipped → no NodeSelection for image.
    // Also: image-view.tsx must NOT use onMouseDown with stopPropagation()
    //   because React 18's capture-phase listener on #root would block PM.
    //
    // Strategy:
    //   mousedown — detect image click via DOM, dispatch NodeSelection.
    //   createSelectionBetween — intercept DOMObserver so it returns
    //     NodeSelection (not TextSelection) until SyntaxReveal expands.

    const pluginKey = new PluginKey("imageClickGuard");

    // Flag: which image was clicked (mousedown sets, createSelectionBetween reads)
    let clickedImagePos: number | null = null;
    let clickedImageTimer: ReturnType<typeof setTimeout> | null = null;

    /** Find PM document position for the N-th image by matching DOM order */
    const findImagePos = (view: EditorView, wrapperIdx: number): number => {
      let imagePos = -1;
      let count = 0;
      view.state.doc.descendants((node, pos) => {
        if (imagePos >= 0) return false; // §perf-large-file: early exit
        if (node.type.name === "image") {
          if (count === wrapperIdx) { imagePos = pos; return false; }
          count++;
        }
      });
      return imagePos;
    };

    return [
      new Plugin({
        key: pluginKey,

        props: {
          // Intercept DOMObserver's selection creation to preserve NodeSelection
          // until SyntaxReveal expands the image (via RAF, ~16ms).
          createSelectionBetween(view) {
            if (clickedImagePos === null) return null;
            const pos = clickedImagePos;
            clickedImagePos = null;
            if (clickedImageTimer) { clearTimeout(clickedImageTimer); clickedImageTimer = null; }
            try {
              if (view.state.doc.resolve(pos).nodeAfter?.type.name === "image") {
                return NodeSelection.create(view.state.doc, pos);
              }
            } catch { /* ignore */ }
            return null;
          },

          handleDOMEvents: {
            mousedown(view, event) {
              if (event.button !== 0) return false;

              const target = event.target as HTMLElement;
              let imageWrapper = target.closest(".image-node-view") as HTMLElement | null;

              // Coordinate-based fallback: WebKit may report wrong event.target.
              if (!imageWrapper) {
                for (const img of view.dom.querySelectorAll("img")) {
                  const rect = img.getBoundingClientRect();
                  if (event.clientX >= rect.left && event.clientX <= rect.right &&
                      event.clientY >= rect.top && event.clientY <= rect.bottom) {
                    imageWrapper = (img as HTMLElement).closest(".image-node-view") as HTMLElement | null
                      ?? (img as HTMLElement).closest("[data-node-view-wrapper]") as HTMLElement | null;
                    if (!imageWrapper) {
                      const figure = (img as HTMLElement).closest("figure");
                      if (figure?.parentElement) {
                        imageWrapper = figure.parentElement as HTMLElement;
                      }
                    }
                    break;
                  }
                }
              }

              if (imageWrapper && !target.closest(".image-toolbar") && !target.closest(".image-caption") && target.tagName !== "INPUT") {
                const allWrappers = view.dom.querySelectorAll(".image-node-view");
                let wrapperIdx = -1;
                for (let i = 0; i < allWrappers.length; i++) {
                  if (allWrappers[i] === imageWrapper) { wrapperIdx = i; break; }
                }
                const imagePos = wrapperIdx >= 0 ? findImagePos(view, wrapperIdx) : -1;

                if (wrapperIdx >= 0 && imagePos >= 0) {
                  try {
                    clickedImagePos = imagePos;
                    if (clickedImageTimer) clearTimeout(clickedImageTimer);
                    clickedImageTimer = setTimeout(() => { clickedImagePos = null; clickedImageTimer = null; }, 500);

                    event.preventDefault();
                    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imagePos)));
                    view.focus();
                    return true;
                  } catch { clickedImagePos = null; }
                }
              }

              // If SyntaxReveal has an active image expansion (![alt](url) text)
              // and user clicked outside it, explicitly dispatch TextSelection.
              // Without this, WebKit's native selection handling after the
              // collapse (appendTransaction) creates a stale selection that
              // keeps the cursor stuck near the image.
              const expanded = getSyntaxRevealExpanded(view.state);
              if (expanded?.kind === "image") {
                const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (coords && (coords.pos < expanded.from || coords.pos > expanded.to)) {
                  try {
                    const $pos = view.state.doc.resolve(coords.pos);
                    event.preventDefault();
                    view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)));
                    view.focus();
                    return true;
                  } catch { /* fall through to default PM handling */ }
                }
              }

              return false;
            },
          },
        },
      }),
    ];
  },

  addInputRules() {
    // ![alt](url) or ![alt](url "title") at start of line → replace with image block
    return [
      new InputRule({
        find: /^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/,
        handler: ({ state, range, match }) => {
          const [, alt, src, title] = match;
          const { tr } = state;
          const imageNode = this.type.create({
            src,
            alt: alt || null,
            title: title || null,
          });

          // Replace the entire parent paragraph (not just text positions)
          // to avoid leaving an empty paragraph remnant above the image.
          const $from = state.doc.resolve(range.from);
          const paraStart = $from.before($from.depth);
          const paraEnd = $from.after($from.depth);
          tr.replaceWith(paraStart, paraEnd, imageNode);

          // Ensure a paragraph exists after the image for the cursor
          const posAfterImage = paraStart + imageNode.nodeSize;
          if (!tr.doc.resolve(posAfterImage).nodeAfter?.isTextblock) {
            tr.insert(posAfterImage, state.schema.nodes.paragraph.create());
          }

          // Place cursor in the paragraph after the image
          tr.setSelection(TextSelection.create(tr.doc, posAfterImage + 1));
        },
      }),
    ];
  },
});
