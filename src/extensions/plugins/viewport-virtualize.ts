import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorView, NodeView } from "@tiptap/pm/view";

// §perf-large-file C4 — A1 NodeView virtualization (Phase 1: mechanism validation).
//
// WHY NodeView (after imperative + decoration both failed sustained typing):
// ProseMirror only calls nodeView.update() for the block that actually changed;
// off-screen blocks' NodeViews are left untouched on a keystroke. So if the
// controller sets content-visibility on an off-screen NodeView's dom, PM does
// NOT re-render that block and does NOT clobber the style (the v5 imperative
// failure was PM re-rendering *default*-rendered blocks via decoration shifts).
// And there is no per-keystroke decoration set to reprocess (the v1/v2/v6
// decoration failure). Net: zero per-keystroke work on off-screen blocks.
//
// Typing-only gating (idle/scroll → reveal all) keeps scrolling native-fast, so
// the off-screen-hide cost is paid only during typing where it wins.
//
// PROTOTYPE: a generic NodeView (renders via the node's own toDOM, so tag/attrs/
// contentDOM match the default) registered for the common simple block types.
// DEV-only, OFF by default; with the flag off the NodeView is a faithful
// passthrough (never hides). Toggle:
//   window.__baramFlags = { virtualize: true };  // enable
//   window.__baramFlags = {};                     // disable
// Validation gate: sustained typing stays fast AND editing/selection is intact.
// Plan: docs/plans/2026-06-13-large-file-perf-c4-virtualization-plan.md.
import { Extension } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const viewportVirtualizeKey = new PluginKey("viewportVirtualize");

/** Block types virtualized in this phase (no existing custom NodeView; cover
 *  ~82% of the CONTEXT.md fixture). Heavy types (code/mermaid/math/table) keep
 *  their own lazy-mounting NodeViews. */
const VIRTUALIZED_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "bulletList",
  "orderedList",
  "taskList",
];

const BUFFER_PX = 1200;
const IDLE_MS = 400;

interface VBlockView extends NodeView {
  dom: HTMLElement;
  setHidden(hidden: boolean, reservePx: number): void;
}

/** Per-editor controller: owns typing/scroll state and toggles the registered
 *  block NodeViews' visibility — only on window change, never per keystroke. */
class VirtualizeController {
  private idleTimer = 0;
  private scroller: HTMLElement | null = null;
  private scrollRaf = 0;
  private started = false;
  private typing = false;
  private view: EditorView | null = null;
  private readonly views = new Set<VBlockView>();

  destroy(): void {
    if (this.view) {
      this.view.dom.removeEventListener("keydown", this.onKeyDown, {
        capture: true,
      });
    }
    this.scroller?.removeEventListener("scroll", this.onScroll);
    window.clearTimeout(this.idleTimer);
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    this.views.clear();
  }

  register(nv: VBlockView, view: EditorView): void {
    if (!this.started) this.start(view);
    this.views.add(nv);
    if (this.typing) this.evaluate(nv);
  }

  unregister(nv: VBlockView): void {
    this.views.delete(nv);
  }

  private evaluate(nv: VBlockView): void {
    if (!this.scroller) return;
    const top = nv.dom.offsetTop;
    const h = nv.dom.offsetHeight;
    const bandTop = this.scroller.scrollTop - BUFFER_PX;
    const bandBottom =
      this.scroller.scrollTop + this.scroller.clientHeight + BUFFER_PX;
    nv.setHidden(top + h < bandTop || top > bandBottom, h);
  }

  private evaluateAll(): void {
    for (const nv of this.views) this.evaluate(nv);
  }

  private exitTyping = (): void => {
    if (!this.typing) return;
    this.typing = false;
    this.showAll();
  };

  private onKeyDown = (): void => {
    if (!flagOn()) return;
    if (!this.typing) {
      this.typing = true;
      this.evaluateAll();
    }
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(this.exitTyping, IDLE_MS);
  };

  private onScroll = (): void => {
    if (!flagOn()) {
      this.exitTyping();
      return;
    }
    if (!this.typing || this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      if (this.typing) this.evaluateAll();
    });
  };

  private showAll(): void {
    for (const nv of this.views) nv.setHidden(false, 0);
  }

  private start(view: EditorView): void {
    this.started = true;
    this.view = view;
    this.scroller = view.dom.closest<HTMLElement>(".editor-area-scroll");
    view.dom.addEventListener("keydown", this.onKeyDown, { capture: true });
    this.scroller?.addEventListener("scroll", this.onScroll, { passive: true });
  }
}

function flagOn(): boolean {
  if (!import.meta.env.DEV) return false;
  return !!(globalThis as { __baramFlags?: { virtualize?: boolean } })
    .__baramFlags?.virtualize;
}

function makeNodeView(
  node: PMNode,
  controller: VirtualizeController,
  view: EditorView,
): VBlockView {
  const toDOM = node.type.spec.toDOM;
  // Render via the node's own toDOM so tag/attrs/contentDOM match the default
  // (faithful passthrough when the flag is off).
  const rendered = toDOM
    ? DOMSerializer.renderSpec(document, toDOM(node))
    : { contentDOM: null, dom: document.createElement("div") };
  const dom = rendered.dom as HTMLElement;
  const contentDOM = (rendered.contentDOM as HTMLElement | null) ?? undefined;
  let current = node;
  let hidden = false;

  const nv: VBlockView = {
    contentDOM,
    dom,
    destroy() {
      controller.unregister(nv);
    },
    ignoreMutation(m) {
      // Ignore our own visibility style writes on the wrapper; never ignore the
      // content edits PM needs (those hit contentDOM children, not this.dom).
      return m.type === "attributes" && m.target === dom;
    },
    setHidden(h: boolean, reservePx: number) {
      if (h === hidden) return;
      hidden = h;
      if (h) {
        dom.style.contentVisibility = "hidden";
        dom.style.containIntrinsicSize = `auto ${Math.max(1, Math.round(reservePx))}px`;
      } else {
        dom.style.contentVisibility = "";
        dom.style.containIntrinsicSize = "";
      }
    },
    update(newNode: PMNode) {
      if (newNode.type !== current.type || !newNode.sameMarkup(current))
        return false;
      current = newNode;
      return true;
    },
  };
  controller.register(nv, view);
  return nv;
}

export const ViewportVirtualize = Extension.create({
  name: "viewportVirtualize",

  addProseMirrorPlugins() {
    const controller = new VirtualizeController();
    const nodeViews: Record<
      string,
      (node: PMNode, view: EditorView) => NodeView
    > = {};
    for (const type of VIRTUALIZED_TYPES) {
      nodeViews[type] = (node, view) => makeNodeView(node, controller, view);
    }
    return [
      new Plugin({
        key: viewportVirtualizeKey,
        props: { nodeViews },
        view() {
          return {
            destroy() {
              controller.destroy();
            },
          };
        },
      }),
    ];
  },
});
