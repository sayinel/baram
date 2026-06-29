// §perf-large-file C4 — true windowing (display:none + pseudo-element spacers).
// Design: docs/plans/2026-06-20-large-file-windowing-design.md.
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import type { EditorView, NodeView } from "@tiptap/pm/view";

import { Extension } from "@tiptap/core";
import { DOMSerializer } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import {
  type Band,
  computeBand,
  computeDelta,
  HeightMap,
} from "./viewport-virtualize-geometry";

/** Light top-level types wrapped by the generic NodeView (PM won't clobber the
 *  wrapper dom's inline style; default-rendered blocks would be clobbered). The
 *  final list is locked by the container-safety spike (plan Task 7). */
export const LIGHT_VIRTUALIZED_TYPES = [
  "paragraph",
  "heading",
  "bulletList",
  "orderedList",
  "taskList",
  "blockquote",
  "horizontalRule",
  "definitionList",
  "callout",
];

/** Heavy top-level types with their own React NodeViews — toggled directly on
 *  their existing dom by the controller, never wrapped. */
export const HEAVY_VIRTUALIZED_TYPES = [
  "codeBlock",
  "mathBlock",
  "mermaidBlock",
  "queryBlock",
  "table",
];

export interface BlockHandle {
  dom: HTMLElement;
  setHidden(hidden: boolean): void;
  /** False for heavy blocks (math/mermaid/code/table) — never display:none'd by
   *  the controller. They own a lazy-visible IntersectionObserver that mounts
   *  their content; display:none removes the observed box, breaking mount +
   *  edit-entry. They stay rendered (cheap — few of them) and the spacer counts
   *  only the hidden light blocks. Defaults to windowable (true) when omitted. */
  windowable?: boolean;
}

export interface BlockNodeView extends BlockHandle, NodeView {
  dom: HTMLElement;
}

export interface Controller {
  register(handle: BlockHandle): void;
  unregister(handle: BlockHandle): void;
}

export function makeBlockNodeView(
  node: PMNode,
  controller: Controller,
): BlockNodeView {
  const toDOM = node.type.spec.toDOM;
  const rendered = toDOM
    ? DOMSerializer.renderSpec(document, toDOM(node))
    : { contentDOM: null, dom: document.createElement("div") };
  const dom = rendered.dom as HTMLElement;
  const contentDOM = (rendered.contentDOM as HTMLElement | null) ?? undefined;
  let current = node;
  let hidden = false;

  const nv: BlockNodeView = {
    contentDOM,
    dom,
    destroy() {
      controller.unregister(nv);
    },
    ignoreMutation(m) {
      // Ignore only our own style write on the wrapper; never ignore content
      // edits (those target contentDOM children, not `dom`).
      return m.type === "attributes" && m.target === dom;
    },
    setHidden(h: boolean) {
      if (h === hidden) return;
      hidden = h;
      dom.style.display = h ? "none" : "";
    },
    update(newNode: PMNode) {
      if (newNode.type !== current.type || !newNode.sameMarkup(current))
        return false;
      current = newNode;
      return true;
    },
    windowable: true,
  };
  controller.register(nv);
  return nv;
}

/** prosemirror-tables renders a table as `div.tableWrapper > table` when column
 *  resizing is on (BaramTable sets `resizable:true`), or a bare `<table>`
 *  otherwise. Either is a heavy block the controller can safely display:none —
 *  tables have NO lazy-visible observer, so hiding the box breaks nothing. */
function isTableWrapper(el: HTMLElement): boolean {
  return el.classList.contains("tableWrapper") || el.tagName === "TABLE";
}

// Off-screen pre-render margin above + below the viewport. A static, generous
// margin: box count doesn't move typing p50 (GUI 2026-06-20), and a DYNAMIC
// small-idle/large-scroll margin lowered the p99 hitch but its shrink-on-idle
// reconcile changed --vtop and made the scroll position jump when you stopped
// scrolling. Correctness (stable scroll) wins; keep it static.
const BUFFER_PX = 1200;
const REMEASURE_MS = 200;
const ESTIMATE_PX = 28;
// Task-1 coordinate spike result: true if `scrollTop` is in VISUAL (zoom-scaled)
// space, so layout `offsetHeight` must be divided by zoom before comparing to
// `scrollTop`. Confirmed in the GUI; left false (LAYOUT space) until then.
const MEASURE_DIVIDES_BY_ZOOM = false;

/** Per-editor windowing controller. Maintains a node-keyed height map, computes
 *  the visible band from scrollTop on scroll (rAF-throttled) — NEVER on typing —
 *  toggles only the delta of blocks crossing the band, and reserves off-screen
 *  height via the `--vtop`/`--vbot` spacer pseudo-elements. */
export class VirtualizeController implements Controller {
  private band: Band | null = null;
  private destroyed = false;
  private engageTimer: null | ReturnType<typeof setTimeout> = null;
  private engageTries = 0;
  private growthTimer: null | ReturnType<typeof setTimeout> = null;
  private handles = new Map<HTMLElement, BlockHandle>();
  private hm = new HeightMap();
  private ordered: BlockHandle[] = [];
  private rafPending = false;
  private remeasureTimer: null | ReturnType<typeof setTimeout> = null;
  private scroller: HTMLElement | null = null;
  private view: EditorView | null = null;

  /** DEV introspection (exposed on window.__virt). */
  debugState(): Record<string, unknown> {
    const hidden = this.ordered.filter(
      (b) => b.dom.style.display === "none",
    ).length;
    const active = (globalThis as Record<string, unknown>).__baramEditor as
      undefined | { view?: EditorView };
    return {
      band: this.band,
      clientHeight: this.scroller?.clientHeight,
      destroyed: this.destroyed,
      domChildren: (this.view?.dom as HTMLElement | undefined)?.children.length,
      engageTries: this.engageTries,
      hidden,
      hmLength: this.hm.length,
      matchesActiveEditor: this.view === active?.view,
      orderedLength: this.ordered.length,
      sampleHeights: [0, 1, 2, 100, 1000].map((i) => this.hm.heightAt(i)),
      scrollerResolved: !!this.scroller,
      scrollTop: this.scroller?.scrollTop,
      totalHeight: this.hm.totalHeight,
      zoom: this.zoom(),
    };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.remeasureTimer) clearTimeout(this.remeasureTimer);
    if (this.engageTimer) clearTimeout(this.engageTimer);
    if (this.growthTimer) clearTimeout(this.growthTimer);
    this.scroller?.removeEventListener("scroll", this.onScroll);
  }

  /** Retry until the scroll container resolves AND is visible (the keep-alive
   *  editor mounts detached / in a hidden tab, so the first attempts fail and
   *  nothing else would re-resolve it — this is the prior `8d881e3` bug), then
   *  run the first reconcile. After engaging, scroll events drive it. */
  engage(): void {
    if (this.destroyed) return;
    const sc = this.ensureScroller();
    if (sc && sc.clientHeight > 0) {
      this.reconcile();
      return;
    }
    if (this.engageTries++ > 50) return; // ~10s safety cap
    this.engageTimer = setTimeout(() => this.engage(), 200);
  }

  /** Re-window ONLY on a STRUCTURAL change (top-level block added/removed). The
   *  band and spacers depend on the block COUNT, never on text typed inside an
   *  already-visible block (a visible block is never reserved by a spacer). A
   *  text-only edit therefore skips the debounced reconcile entirely: reconcile's
   *  measureBand() reads offsetHeight over the displayed blocks and FORCES A FULL
   *  REFLOW, which on a ~3,000-block doc cost ~1s on the first keystrokes (the
   *  "first few chars are slow" symptom, profiled 2026-06-23). Scroll still
   *  refreshes heights via onScroll; progressive-load growth still re-windows
   *  because each appended chunk changes the top-level block count. */
  onUpdate(structuralChange: boolean): void {
    if (!structuralChange || this.destroyed) return;
    if (this.remeasureTimer) clearTimeout(this.remeasureTimer);
    this.remeasureTimer = setTimeout(() => {
      this.remeasureTimer = null;
      if (this.destroyed) return;
      // Debounced (not per-keystroke) → safe to run a full reconcile. This also
      // re-windows after progressive load finishes (block count grew) WITHOUT
      // needing a user scroll: the last load chunk's tx schedules this.
      this.reconcile();
    }, REMEASURE_MS);
  }

  reconcile(): void {
    const sc = this.ensureScroller();
    if (!sc || this.destroyed) return;
    const blocks = this.collectBlocks();
    if (blocks.length === 0) return;

    const firstPass = this.hm.length !== blocks.length;
    if (firstPass) {
      this.rebuildKeys();
      // Measure all currently-displayed blocks for accurate spacers.
      this.measureBand({ first: 0, last: blocks.length - 1 });
      // Block count changed (first load / progressive growth / structural edit)
      // → force a FULL pass below. A delta from a stale band near the top would
      // never hide the newly-appended tail (hide = prev \ next = ∅).
      this.band = null;
      // Likely still progressively loading (chunks appended over idle ticks).
      // Self-schedule a follow-up so we keep windowing as the doc grows even if
      // onUpdate's debounce was cleared by a reconfigure destroy(). Self-stops
      // once the count stabilizes (firstPass false → no reschedule).
      if (this.growthTimer) clearTimeout(this.growthTimer);
      this.growthTimer = setTimeout(() => {
        this.growthTimer = null;
        if (!this.destroyed) this.reconcile();
      }, 300);
    }

    const z = this.zoom();
    const next = computeBand(
      sc.scrollTop / z,
      sc.clientHeight / z,
      BUFFER_PX,
      this.hm,
    );
    this.applyBand(blocks, next);
    if (!firstPass) this.measureBand(next); // measure newly-revealed blocks
    this.applySpacers();
  }

  register(handle: BlockHandle): void {
    this.handles.set(handle.dom, handle);
  }

  /** Reveal every block (e.g. for export); pair with a later rewindow(). */
  revealAll(): void {
    for (const b of this.collectBlocks()) b.setHidden(false);
    this.setVars(0, 0);
  }

  /** Force the window to include the block at doc position `pos`, then
   *  reconcile — call BEFORE scrollIntoView to an off-screen target. */
  revealBlock(pos: number): void {
    const blocks = this.collectBlocks();
    if (!blocks.length || !this.view) return;
    const doc = this.view.state.doc;
    const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
    const index = Math.min(Math.max(0, $pos.index(0)), blocks.length - 1);
    this.revealAround(index, blocks);
  }

  /** Force the window to include the top-level block containing `el` (for
   *  callers that hold a DOM node, not a doc position). */
  revealElement(el: HTMLElement): void {
    const root = this.view?.dom as HTMLElement | undefined;
    const blocks = this.collectBlocks();
    if (!root || !blocks.length) return;
    let top: HTMLElement | null = el;
    while (top && top.parentElement !== root) top = top.parentElement;
    if (!top) return;
    const index = blocks.findIndex((b) => b.dom === top);
    if (index >= 0) this.revealAround(index, blocks);
  }

  /** Re-apply windowing from scratch (after a full reveal). */
  rewindow(): void {
    this.band = null;
    this.reconcile();
  }

  setView(view: EditorView): void {
    this.view = view;
    // REVIVE: ProseMirror's updatePluginViews destroys + recreates ALL plugin
    // views whenever the plugins array reference changes (every reconfigure /
    // registerPlugin — e.g. @tiptap/react menus). The controller is created once
    // per plugin INSTANCE (in addProseMirrorPlugins) and reused across these
    // recreations, so a one-way destroy() would leave it permanently dead
    // (engage/reconcile bail on `destroyed`). Reset here so each recreated plugin
    // view re-attaches a working controller. (handles/hm are preserved.)
    if (this.destroyed) {
      this.destroyed = false;
      this.scroller = null;
      this.band = null;
      this.engageTries = 0;
    }
    this.ensureScroller();
  }

  unregister(handle: BlockHandle): void {
    this.handles.delete(handle.dom);
  }

  /** Show blocks inside `next`, hide outside. Cheap delta from the previous
   *  band when set; a full pass when band is null (first load / post-reveal /
   *  post-rewindow), since the DOM may have arbitrary blocks shown. */
  private applyBand(blocks: BlockHandle[], next: Band): void {
    if (this.band === null) {
      for (let i = 0; i < blocks.length; i++)
        blocks[i]?.setHidden(i < next.first || i > next.last);
    } else {
      const { hide, show } = computeDelta(this.band, next);
      for (const i of show) blocks[i]?.setHidden(false);
      for (const i of hide) blocks[i]?.setHidden(true);
    }
    this.band = next;
  }

  private applySpacers(): void {
    if (!this.band) return;
    const { first, last } = this.band;
    // Reserve only the HIDDEN windowable (light) blocks' heights. Non-windowable
    // blocks (heavy/image/…) stay rendered as real boxes, so they must NOT be
    // counted here or the spacer would double-count their height.
    let vtop = 0;
    for (let i = 0; i < first; i++)
      if (this.ordered[i]?.windowable !== false) vtop += this.hm.heightAt(i);
    let vbot = 0;
    for (let i = last + 1; i < this.ordered.length; i++)
      if (this.ordered[i]?.windowable !== false) vbot += this.hm.heightAt(i);
    this.setVars(vtop, vbot);
  }

  /** Doc-order handles from .tiptap's direct children. Light blocks resolve to
   *  their registered NodeView handle; tables get an ad-hoc handle toggling
   *  their wrapper dom directly; other heavy blocks stay non-windowable. */
  private collectBlocks(): BlockHandle[] {
    const root = this.view?.dom as HTMLElement | undefined;
    if (!root) return [];
    const out: BlockHandle[] = [];
    for (const el of Array.from(root.children) as HTMLElement[]) {
      const light = this.handles.get(el);
      if (light) {
        // Registered light NodeView block — windowed via its own setHidden.
        out.push(light);
      } else if (isTableWrapper(el)) {
        // §perf-large-file heavy-block windowing (Phase 0): tables build their
        // cell contentDOM eagerly and own NO lazy-visible IntersectionObserver,
        // so display:none only skips off-screen LAYOUT and is fully reversible.
        // Toggle it directly on the existing prosemirror-tables wrapper — no
        // custom NodeView needed. Counted in the spacer (windowable: true). The
        // ad-hoc handle is recreated each pass; applyBand writes display
        // idempotently, so no per-table hidden-state closure is needed.
        out.push({
          dom: el,
          setHidden: (h) => {
            el.style.display = h ? "none" : "";
          },
          windowable: true,
        });
      } else {
        // Other heavy blocks (math/mermaid/code lazy-visible NodeViews, images,
        // frontmatter, …) are never display:none'd — display:none removes a
        // lazy-visible block's observed box so its content never mounts (math
        // edit-entry lag, mermaid broken).
        out.push({ dom: el, setHidden: () => {}, windowable: false });
      }
    }
    this.ordered = out;
    return out;
  }

  /** Resolve the scroll container lazily (the keep-alive editor mounts detached
   *  — NodeViews register before <EditorContent> attaches). */
  private ensureScroller(): HTMLElement | null {
    if (this.scroller) return this.scroller;
    const sc =
      this.view?.dom.closest<HTMLElement>(".editor-area-scroll") ?? null;
    if (sc) {
      this.scroller = sc;
      sc.addEventListener("scroll", this.onScroll, { passive: true });
    }
    return sc;
  }

  private keyOf(el: HTMLElement, i: number): string {
    return el.getAttribute("data-block-id") ?? `#${i}`;
  }

  /** Measure displayed blocks in [band.first, band.last] into the height map.
   *  Pure READS in the loop (no interleaved writes) → a single forced layout. */
  private measureBand(band: Band): void {
    const z = this.zoom();
    for (let i = Math.max(0, band.first); i <= band.last; i++) {
      const el = this.ordered[i]?.dom;
      if (!el || el.style.display === "none") continue;
      const h = el.offsetHeight / z;
      if (h > 0) this.hm.setHeight(i, h);
    }
  }

  private onScroll = (): void => {
    if (this.rafPending || this.destroyed) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.reconcile();
    });
  };

  /** (Re)build the height-map keys from current DOM order, preserving measured
   *  heights by key across structural edits. */
  private rebuildKeys(): void {
    const keys = this.ordered.map((b, i) => this.keyOf(b.dom, i));
    // Always syncKeys (never reset): preserves measured heights by key across
    // progressive-load appends + edits, so off-screen spacers don't revert to
    // estimates on every count change.
    this.hm.syncKeys(keys, ESTIMATE_PX);
  }

  /** Reveal a window CENTRED on `index` (independent of current scroll) so a
   *  following scrollIntoView finds the target with real geometry; the post-
   *  scroll reconcile then re-centres on the landing position. */
  private revealAround(index: number, blocks: BlockHandle[]): void {
    if (this.hm.length !== blocks.length) {
      this.rebuildKeys();
      this.measureBand({ first: 0, last: blocks.length - 1 });
    }
    const sc = this.ensureScroller();
    const z = this.zoom();
    const vh = sc ? sc.clientHeight / z : 800;
    // Reveal generously around the target (it's about to be scrolled into view).
    const next = computeBand(this.hm.offsetAt(index), vh, BUFFER_PX, this.hm);
    this.band = null; // full pass: hide the old viewport, show the target band
    this.applyBand(blocks, next);
    this.measureBand(next);
    this.applySpacers();
  }

  private setVars(vtop: number, vbot: number): void {
    const root = this.view?.dom as HTMLElement | undefined;
    root?.style.setProperty("--vtop", `${Math.round(vtop)}px`);
    root?.style.setProperty("--vbot", `${Math.round(vbot)}px`);
  }

  private zoom(): number {
    if (!MEASURE_DIVIDES_BY_ZOOM || !this.scroller) return 1;
    return parseFloat(getComputedStyle(this.scroller).zoom) || 1;
  }
}

export const viewportVirtualizeKey = new PluginKey("viewportVirtualize");

export interface ViewportVirtualizeOptions {
  /** Runtime kill-switch; the large-doc gate is the conditional registration in
   *  createBaramExtensions (small docs never get this extension). */
  isEnabled: () => boolean;
}

/** The active large-doc controller, for module-level nav/export helpers. Set in
 *  the plugin's view() when enabled, cleared on destroy. */
let activeController: null | VirtualizeController = null;

/** Test-only: the controller of the most recently created enabled editor. */
export function _activeControllerForTest(): null | VirtualizeController {
  return activeController;
}

/** Force the active large-doc editor's window to include `pos` (no-op when no
 *  controller is active). Call before scrollIntoView to an off-screen target. */
export function revealBlockInActiveEditor(pos: number): void {
  activeController?.revealBlock(pos);
}

/** Like revealBlockInActiveEditor but for callers holding a DOM node (no pos). */
export function revealElementInActiveEditor(el: HTMLElement): void {
  activeController?.revealElement(el);
}

/** Reveal every block for the duration of `fn` (e.g. export clones the DOM),
 *  then re-window. No-op when no controller is active. */
export function withVirtualizationSuspended<T>(fn: () => T): T {
  const c = activeController;
  if (!c) return fn();
  c.revealAll();
  try {
    return fn();
  } finally {
    c.rewindow();
  }
}

/** Inert NodeView: renders via toDOM, no controller registration, no hiding. */
function passthroughNodeView(node: PMNode): NodeView {
  const toDOM = node.type.spec.toDOM;
  const rendered = toDOM
    ? DOMSerializer.renderSpec(document, toDOM(node))
    : { contentDOM: null, dom: document.createElement("div") };
  return {
    contentDOM: (rendered.contentDOM as HTMLElement | null) ?? undefined,
    dom: rendered.dom as HTMLElement,
  };
}

export const ViewportVirtualize = Extension.create<ViewportVirtualizeOptions>({
  name: "viewportVirtualize",

  addOptions() {
    return { isEnabled: () => false };
  },

  addProseMirrorPlugins() {
    const enabled = this.options.isEnabled;
    const controller = new VirtualizeController();
    const nodeViews: Record<string, (node: PMNode) => NodeView> = {};
    for (const type of LIGHT_VIRTUALIZED_TYPES) {
      nodeViews[type] = (node) =>
        enabled()
          ? makeBlockNodeView(node, controller)
          : passthroughNodeView(node);
    }
    return [
      new Plugin({
        key: viewportVirtualizeKey,
        props: { nodeViews },
        view: (view) => {
          if (enabled()) {
            controller.setView(view);
            activeController = controller;
            // DEV-only perf introspection (window.__virt.debugState()).
            if (import.meta.env.DEV)
              (globalThis as Record<string, unknown>).__virt = controller;
            // Engage once the scroller resolves + is visible (retries through
            // the detached/hidden-tab mount window). Scroll drives it after.
            controller.engage();
          }
          return {
            destroy: () => {
              if (activeController === controller) activeController = null;
              controller.destroy();
            },
            update: (v, prev: EditorState) => {
              // Only a top-level block-count delta needs a re-window. Text edits
              // inside a block must NOT trigger reconcile's measureBand reflow
              // (the per-keystroke ~1s freeze on large docs).
              if (enabled())
                controller.onUpdate(
                  v.state.doc.childCount !== prev.doc.childCount,
                );
            },
          };
        },
      }),
    ];
  },
});
