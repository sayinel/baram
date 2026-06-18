import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";

// §perf-large-file C4 — A1 NodeView virtualization (ALWAYS-ON).
//
// WHY NodeView: ProseMirror only calls nodeView.update() for the block that
// actually changed, so off-screen blocks' NodeViews are left untouched on a
// keystroke. The controller sets content-visibility:hidden on off-screen
// NodeView doms, and PM does NOT clobber it (the v5 imperative failure was PM
// re-rendering *default* blocks via decoration shifts) and there is no
// per-keystroke decoration set to reprocess (v1/v2/v6 decoration failure).
//
// WHY ALWAYS-ON (not typing-only): keeping off-screen blocks hidden at ALL times
// means EVERY interaction (typing, scroll, click-to-cursor, math/mermaid
// edit-entry, navigation) forces layout over the viewport only — not the whole
// ~3,500-block document. The window is maintained by delta-toggling only the
// blocks that crossed the viewport boundary, using a position cache (no layout
// read per keystroke/scroll-frame), so maintaining it is cheap.
//
// PROTOTYPE SCOPE: a generic NodeView (renders via the node's own toDOM, so
// tag/attrs/contentDOM match the default) for the safe leaf blocks
// (paragraph+heading, ~62% of the fixture). Container types (lists/blockquote)
// broke math/mermaid edit-entry with the generic NodeView and are deferred.
// DEV-only, OFF by default; flag-off the NodeView is a faithful passthrough.
//   window.__baramFlags = { virtualize: true };  // enable
//   window.__baramFlags = {};                     // disable
// Plan: docs/plans/2026-06-13-large-file-perf-c4-virtualization-plan.md.
import { Extension } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const viewportVirtualizeKey = new PluginKey("viewportVirtualize");

const VIRTUALIZED_TYPES = ["paragraph", "heading"];
// Heavy top-level blocks that already own React NodeViews (so we can't wrap them
// with the generic NodeView). The controller hides them off-screen by toggling
// content-visibility directly on their DOM — safe because PM does not re-render
// an off-screen NodeView, so the style is not clobbered.
const HEAVY_TYPES = [
  "codeBlock",
  "mermaidBlock",
  "mathBlock",
  "queryBlock",
  "table",
];
const BUFFER_PX = 1200;
/** Debounce for re-measuring positions after content edits. */
const REMEASURE_MS = 200;

interface VBlockView extends NodeView {
  dom: HTMLElement;
  setHidden(hidden: boolean, reservePx: number): void;
}

/** Per-editor controller: keeps off-screen block NodeViews hidden at all times,
 *  maintaining the visible window on scroll + edits from a position cache. */
class VirtualizeController {
  private anyHidden = false;
  private externals: { bottom: number; el: HTMLElement; top: number }[] = [];
  private readonly positions = new Map<
    VBlockView,
    { bottom: number; top: number }
  >();
  private remeasureTimer = 0;
  private scroller: HTMLElement | null = null;
  private scrollRaf = 0;
  private started = false;
  private view: EditorView | null = null;
  private readonly views = new Set<VBlockView>();

  destroy(): void {
    this.scroller?.removeEventListener("scroll", this.onScroll);
    window.clearTimeout(this.remeasureTimer);
    if (this.scrollRaf) cancelAnimationFrame(this.scrollRaf);
    this.views.clear();
    this.positions.clear();
  }

  /** Called from the plugin's view.update() on every transaction. */
  onUpdate(docChanged: boolean): void {
    this.apply(docChanged);
  }

  register(nv: VBlockView, view: EditorView): void {
    if (!this.started) this.start(view);
    this.views.add(nv);
    // A block created/re-created during scrolling should hide immediately if
    // it is already outside the window.
    if (flagOn() && this.positions.size > 0) this.evaluate(nv);
  }

  unregister(nv: VBlockView): void {
    this.views.delete(nv);
    this.positions.delete(nv);
  }

  /** Main entry: keep the window current. Uses the position cache (no layout
   *  read); only the blocks crossing the boundary toggle content-visibility. */
  private apply(docChanged: boolean): void {
    if (!flagOn()) {
      if (this.anyHidden) this.showAll();
      return;
    }
    if (this.positions.size === 0) this.measure();
    if (docChanged) this.scheduleRemeasure();
    this.evaluateAll();
  }

  private buildExternals(): void {
    this.externals = [];
    const view = this.view;
    if (!view) return;
    view.state.doc.forEach((node, offset) => {
      if (!HEAVY_TYPES.includes(node.type.name)) return;
      const el = view.nodeDOM(offset);
      if (el instanceof HTMLElement) {
        const t = el.offsetTop;
        this.externals.push({ bottom: t + el.offsetHeight, el, top: t });
      }
    });
  }

  private evaluate(nv: VBlockView): void {
    if (!this.scroller) return;
    let p = this.positions.get(nv);
    if (!p) {
      const t = nv.dom.offsetTop;
      p = { bottom: t + nv.dom.offsetHeight, top: t };
      this.positions.set(nv, p);
    }
    const bandTop = this.scroller.scrollTop - BUFFER_PX;
    const bandBottom =
      this.scroller.scrollTop + this.scroller.clientHeight + BUFFER_PX;
    const hide = p.bottom < bandTop || p.top > bandBottom;
    if (hide) this.anyHidden = true;
    nv.setHidden(hide, p.bottom - p.top);
  }

  private evaluateAll(): void {
    for (const nv of this.views) this.evaluate(nv);
    this.evaluateExternals();
  }

  /** Hide off-screen heavy blocks (own React Nodeviews) by toggling
   *  content-visibility on their DOM directly. */
  private evaluateExternals(): void {
    if (!this.scroller) return;
    const bandTop = this.scroller.scrollTop - BUFFER_PX;
    const bandBottom =
      this.scroller.scrollTop + this.scroller.clientHeight + BUFFER_PX;
    for (const e of this.externals) {
      const hide = e.bottom < bandTop || e.top > bandBottom;
      const want = hide ? "hidden" : "";
      if (e.el.style.contentVisibility === want) continue;
      e.el.style.contentVisibility = want;
      e.el.style.containIntrinsicSize = hide
        ? `auto ${Math.max(1, Math.round(e.bottom - e.top))}px`
        : "";
      if (hide) this.anyHidden = true;
    }
  }

  /** Read every block's doc-relative position into the cache. One forced layout
   *  (off-screen blocks are cheap — content-visibility skips their contents).
   *  Run at activation and debounced after edits, never per keystroke. */
  private measure(): void {
    for (const nv of this.views) {
      const t = nv.dom.offsetTop;
      this.positions.set(nv, { bottom: t + nv.dom.offsetHeight, top: t });
    }
    this.buildExternals();
  }

  private onScroll = (): void => {
    if (this.scrollRaf) return;
    this.scrollRaf = requestAnimationFrame(() => {
      this.scrollRaf = 0;
      this.apply(false);
    });
  };

  private scheduleRemeasure(): void {
    window.clearTimeout(this.remeasureTimer);
    this.remeasureTimer = window.setTimeout(() => {
      if (!flagOn()) return;
      this.measure();
      this.evaluateAll();
    }, REMEASURE_MS);
  }

  private showAll(): void {
    for (const nv of this.views) nv.setHidden(false, 0);
    for (const e of this.externals) {
      e.el.style.contentVisibility = "";
      e.el.style.containIntrinsicSize = "";
    }
    this.anyHidden = false;
    // Positions are stale once everything is laid out differently; drop them so
    // the next activation re-measures.
    this.positions.clear();
    this.externals = [];
  }

  private start(view: EditorView): void {
    this.started = true;
    this.view = view;
    this.scroller = view.dom.closest<HTMLElement>(".editor-area-scroll");
    this.scroller?.addEventListener("scroll", this.onScroll, { passive: true });
    requestAnimationFrame(() => this.apply(false));
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
            update(view: EditorView, prevState: EditorState) {
              // §perf-large-file C4: detect a doc change by REFERENCE, not
              // `doc.eq()`. `view.update()` runs inside `view.dispatch`, so a
              // deep whole-doc `doc.eq(prevState.doc)` here cost ~O(doc) on EVERY
              // keystroke — even with the flag OFF (this plugin is always
              // registered) — and was a second hidden typing-latency floor
              // alongside the auto-save one. ProseMirror creates a new doc object
              // whenever content changes, so `!==` is an O(1), correct change
              // check (matches syntax-reveal.ts). A rare identical-content
              // replacement reads as "changed" → at worst one extra debounced
              // remeasure, which is harmless.
              controller.onUpdate(view.state.doc !== prevState.doc);
            },
          };
        },
      }),
    ];
  },
});
