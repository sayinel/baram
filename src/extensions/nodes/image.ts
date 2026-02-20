// §5.1 Image Extension (block-level) with §3.3 NodeView
import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin, PluginKey, NodeSelection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ImageView } from "./image-view";

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
    // Root cause: React 18 registers a capture-phase mousedown listener on
    // #root. Any React onMouseDown handler that calls e.stopPropagation()
    // will call nativeEvent.stopPropagation() during capture at #root,
    // preventing the event from reaching ProseMirror's bubble-phase handler.
    // Additionally, trackpad tap/click moves mouse >4px → PM allowDefault=true
    //   → selectClickedLeaf skipped → no NodeSelection for image
    //   → DOMObserver reads browser's native caret → dispatches TextSelection
    //
    // Fix: image-view.tsx must NOT use onMouseDown with stopPropagation().
    // This plugin handles all image click logic via handleDOMEvents.mousedown.
    //
    // Defense strategy (3 layers, working WITH ProseMirror):
    //   Layer 1: mousedown — dispatch NodeSelection immediately
    //            (with coordinate-based fallback for wrong event.target)
    //   Layer 2: createSelectionBetween — intercept DOMObserver's selection
    //            creation so it produces NodeSelection, not TextSelection
    //   Layer 3: appendTransaction — last-resort guard if layers 1+2 fail

    const pluginKey = new PluginKey("imageClickGuard");

    // Layer 2 flag: which image was clicked (mousedown sets, createSelectionBetween reads)
    let clickedImagePos: number | null = null;
    let clickedImageTimer: ReturnType<typeof setTimeout> | null = null;

    // Layer 3 guard — protects NodeSelection from DOMObserver override
    let guardImagePos: number | null = null;
    let guardTimer: ReturnType<typeof setTimeout> | null = null;
    let guardCorrectionCount = 0;
    const MAX_GUARD = 5;

    const setGuard = (pos: number) => {
      guardImagePos = pos;
      guardCorrectionCount = 0;
      if (guardTimer) clearTimeout(guardTimer);
      guardTimer = setTimeout(() => { guardImagePos = null; guardTimer = null; }, 300);
    };

    // Track when we last set NodeSelection on an image.
    // WebKit may fail to update native selection when clicking away from
    // a block-selected NodeView; we use this to explicitly dispatch
    // TextSelection for subsequent non-image clicks.
    let lastImageSelTime = 0;

    /** Find PM document position for the N-th image by matching DOM order */
    const findImagePos = (view: EditorView, wrapperIdx: number): number => {
      let imagePos = -1;
      let count = 0;
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === "image") {
          if (count === wrapperIdx) imagePos = pos;
          count++;
        }
      });
      return imagePos;
    };

    return [
      new Plugin({
        key: pluginKey,

        // Layer 3: last-resort correction if DOMObserver still overrides
        appendTransaction(transactions, _oldState, newState) {
          if (guardImagePos === null) return null;
          if (transactions.some(tr => tr.getMeta(pluginKey))) return null;

          try {
            const nodeAfter = newState.doc.resolve(guardImagePos).nodeAfter;
            if (nodeAfter?.type.name !== "image") { guardImagePos = null; return null; }
            const sel = newState.selection;
            if (!(sel instanceof NodeSelection) || sel.from !== guardImagePos) {
              if (guardCorrectionCount >= MAX_GUARD) { guardImagePos = null; return null; }
              guardCorrectionCount++;
              const tr = newState.tr.setSelection(NodeSelection.create(newState.doc, guardImagePos));
              tr.setMeta(pluginKey, true);
              return tr;
            }
          } catch { guardImagePos = null; }
          return null;
        },

        props: {
          // Layer 2: intercept DOMObserver's selection creation
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

              // Clear stale guards — a new user click should not be fought
              // by guards from the previous image selection.
              guardImagePos = null;
              clickedImagePos = null;
              if (clickedImageTimer) { clearTimeout(clickedImageTimer); clickedImageTimer = null; }
              if (guardTimer) { clearTimeout(guardTimer); guardTimer = null; }

              const target = event.target as HTMLElement;
              let imageWrapper = target.closest(".image-node-view") as HTMLElement | null;

              // Coordinate-based fallback: if event.target is not inside
              // an image wrapper (e.g. WebKit reports wrong target), check
              // if click coordinates overlap any <img> bounding rect.
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

              // === Case 1: click on image body → NodeSelection ===
              if (imageWrapper && !target.closest(".image-toolbar") && !target.closest(".image-caption") && target.tagName !== "INPUT") {
                const allWrappers = view.dom.querySelectorAll(".image-node-view");
                let wrapperIdx = -1;
                for (let i = 0; i < allWrappers.length; i++) {
                  if (allWrappers[i] === imageWrapper) { wrapperIdx = i; break; }
                }
                const imagePos = wrapperIdx >= 0 ? findImagePos(view, wrapperIdx) : -1;

                if (wrapperIdx >= 0 && imagePos >= 0) {
                  try {
                    // Layer 2: flag for createSelectionBetween
                    clickedImagePos = imagePos;
                    if (clickedImageTimer) clearTimeout(clickedImageTimer);
                    clickedImageTimer = setTimeout(() => { clickedImagePos = null; clickedImageTimer = null; }, 500);

                    // Layer 3: appendTransaction guard
                    setGuard(imagePos);

                    // Layer 1: direct dispatch + focus
                    event.preventDefault();
                    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, imagePos)));
                    view.focus();
                    lastImageSelTime = Date.now();

                    return true;
                  } catch { guardImagePos = null; clickedImagePos = null; }
                }
                return false;
              }

              // Non-image click: if we recently set NodeSelection on an image,
              // explicitly dispatch TextSelection. WebKit fails to update the
              // native selection when clicking away from a block-selected NodeView,
              // so ProseMirror's default handling (which relies on DOMObserver
              // reading the native selection) doesn't move the cursor.
              if (Date.now() - lastImageSelTime < 5000) {
                lastImageSelTime = 0;
                const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
                if (coords) {
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
          tr.replaceWith(range.from, range.to, this.type.create({
            src,
            alt: alt || null,
            title: title || null,
          }));
        },
      }),
    ];
  },
});
