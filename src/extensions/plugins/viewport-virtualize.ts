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

/** Per-editor controller: keeps off-screen block NodeViews hidden via an
 *  IntersectionObserver, so the window updates itself on scroll with NO
 *  per-keystroke or per-scroll-frame work in our code.
 *
 *  §perf-large-file C4 — why IntersectionObserver (3rd design):
 *  - v1 (per-keystroke evaluateAll over all blocks) FROZE the editor.
 *  - v2 (scroll-only reconcile with cached offsetTop vs scrollTop band math)
 *    blanked the screen: `.editor-area-scroll` has CSS `zoom`, under which
 *    offsetTop/scrollTop live in mismatched coordinate spaces, so every block
 *    was judged off-screen and never revealed.
 *  - v3 (this): IO computes intersection from real rendered geometry, so it is
 *    inherently zoom-correct and needs ZERO coordinate math. Root = viewport
 *    (null) + a rootMargin buffer — exactly the proven pattern in
 *    lazy-visible.ts. Typing fires no IO callbacks (the visible set doesn't
 *    change), so typing pays nothing; scrolling fires only the delta of blocks
 *    crossing the buffer. content-visibility:hidden + contain-intrinsic-size
 *    keeps each hidden block's box (so scroll height stays correct and IO can
 *    still see it re-enter). */
class VirtualizeController {
  private heavyTimer = 0;
  private io: IntersectionObserver | null = null;
  private readonly nvByDom = new WeakMap<Element, VBlockView>();
  private scroller: HTMLElement | null = null;
  private started = false;
  private view: EditorView | null = null;
  private readonly views = new Set<VBlockView>();

  destroy(): void {
    this.scroller?.removeEventListener("scroll", this.onScroll);
    window.clearTimeout(this.heavyTimer);
    this.io?.disconnect();
    this.io = null;
    this.views.clear();
  }

  /** Called from the plugin's view.update() on every transaction. Does NO
   *  windowing work — IO handles that. It only (a) flips enabled state when the
   *  flag toggles and (b) debounce-observes any newly-added heavy blocks. */
  onUpdate(docChanged: boolean): void {
    this.syncEnabled();
    if (this.io && docChanged) this.scheduleHeavySync();
  }

  register(nv: VBlockView, view: EditorView): void {
    if (!this.started) this.start(view);
    this.views.add(nv);
    this.nvByDom.set(nv.dom, nv);
    this.io?.observe(nv.dom);
  }

  unregister(nv: VBlockView): void {
    this.views.delete(nv);
    this.nvByDom.delete(nv.dom);
    this.io?.unobserve(nv.dom);
  }

  private disable(): void {
    this.io?.disconnect();
    this.io = null;
    this.showAll();
  }

  private enable(): void {
    if (this.io) return;
    this.io = new IntersectionObserver(this.onIntersect, {
      rootMargin: `${BUFFER_PX}px 0px ${BUFFER_PX}px 0px`,
      threshold: 0,
    });
    for (const nv of this.views) this.io.observe(nv.dom);
    this.observeHeavy();
  }

  /** Resolve the scroll container once and attach a passive scroll listener
   *  whose ONLY job is to detect a runtime flag toggle (O(1) syncEnabled); IO
   *  itself does the windowing. The keep-alive editor can be detached at first
   *  call, so this is retried from start()/onUpdate until it succeeds. */
  private ensureScroller(): void {
    if (this.scroller) return;
    const s =
      this.view?.dom.closest<HTMLElement>(".editor-area-scroll") ?? null;
    if (!s) return;
    this.scroller = s;
    s.addEventListener("scroll", this.onScroll, { passive: true });
  }

  /** Observe heavy top-level blocks (codeBlock/mermaid/math/query/table — they
   *  own React NodeViews so we can't wrap them). Idempotent: observe() on an
   *  already-observed element is a no-op. */
  private observeHeavy(): void {
    const view = this.view;
    const io = this.io;
    if (!view || !io) return;
    view.state.doc.forEach((node, offset) => {
      if (!HEAVY_TYPES.includes(node.type.name)) return;
      const el = view.nodeDOM(offset);
      if (el instanceof HTMLElement && !this.nvByDom.has(el)) io.observe(el);
    });
  }

  private onIntersect = (entries: IntersectionObserverEntry[]): void => {
    for (const e of entries) {
      const el = e.target as HTMLElement;
      const hide = !e.isIntersecting;
      // Use the rect IO already computed (no forced layout — reading offsetHeight
      // per entry in this loop would thrash read/write and re-freeze the editor).
      const reserve = Math.max(1, Math.round(e.boundingClientRect.height));
      const nv = this.nvByDom.get(el);
      if (nv) nv.setHidden(hide, reserve);
      else this.setHeavyHidden(el, hide, reserve);
    }
  };

  // Scroll only reconciles enabled state (O(1)); IO does the real windowing.
  private onScroll = (): void => {
    this.syncEnabled();
  };

  private scheduleHeavySync(): void {
    window.clearTimeout(this.heavyTimer);
    this.heavyTimer = window.setTimeout(() => {
      if (this.io) this.observeHeavy();
    }, REMEASURE_MS);
  }

  private setHeavyHidden(
    el: HTMLElement,
    hide: boolean,
    reserve: number,
  ): void {
    const cur = el.style.contentVisibility === "hidden";
    if (cur === hide) return;
    if (hide) {
      el.style.contentVisibility = "hidden";
      el.style.containIntrinsicSize = `auto ${reserve}px`;
    } else {
      el.style.contentVisibility = "";
      el.style.containIntrinsicSize = "";
    }
  }

  private showAll(): void {
    for (const nv of this.views) nv.setHidden(false, 0);
    const view = this.view;
    if (view) {
      view.state.doc.forEach((node, offset) => {
        if (!HEAVY_TYPES.includes(node.type.name)) return;
        const el = view.nodeDOM(offset);
        if (el instanceof HTMLElement) this.setHeavyHidden(el, false, 0);
      });
    }
  }

  private start(view: EditorView): void {
    this.started = true;
    this.view = view;
    this.ensureScroller();
    this.syncEnabled();
  }

  /** Enable/disable the observer to match the flag (checked on every tx + on
   *  scroll, so a runtime DEV-flag toggle is picked up either way). */
  private syncEnabled(): void {
    this.ensureScroller();
    const on = flagOn();
    if (on && !this.io) this.enable();
    else if (!on && this.io) this.disable();
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
