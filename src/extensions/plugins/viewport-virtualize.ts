import type { EditorView } from "@tiptap/pm/view";

// §perf-large-file C4 — Phase 0 SPIKE: block-level virtualization probe.
//
// Evidence (window.__baramPerf on the CONTEXT.md fixture): ~97% of per-keystroke
// transaction cost is WebKit layout/DOM (PM updateState + scroll-into-view /
// coordsAtPos forcing synchronous layout over ~3,500 blocks); plugin apply is
// only ~3%. This plugin tests whether hiding OFF-SCREEN top-level blocks
// (content-visibility:hidden + contain-intrinsic-size) removes them from that
// forced layout and collapses the typing cost.
//
// SPIKE — DEV-only, OFF by default, no doc mutation (decorations only), so it is
// a no-op unless explicitly toggled. Toggle live in the DevTools console:
//   window.__baramFlags = { virtualize: true };            // enable
//   window.__baramFlags = { virtualize: true, shim: false }; // measure UN-shimmed click (plan §12 AM-5)
//   window.__baramFlags = {};                              // disable
// Then scroll once (to trigger the first window compute) and measure typing via
// __baramPerf (avgTxMs OFF vs ON) and a timed click into an off-screen region.
//
// This is throwaway measurement scaffolding; the production design is
// docs/plans/2026-06-13-large-file-perf-c4-virtualization-plan.md. Delete or
// harden after the Phase 0 go/no-go gate.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const viewportVirtualizeKey = new PluginKey<DecorationSet>(
  "viewportVirtualize",
);

interface VirtualizeFlags {
  /** Pre-reveal-on-mousedown shim (default ON). Set false to measure the
   *  un-shimmed forced reflow the GO gate actually depends on. */
  shim?: boolean;
  /** Master toggle. */
  virtualize?: boolean;
}

function flags(): VirtualizeFlags {
  if (!import.meta.env.DEV) return {};
  return (globalThis as { __baramFlags?: VirtualizeFlags }).__baramFlags ?? {};
}

/** Render the viewport plus this much above/below (px). */
const BUFFER_PX = 1000;

/** Compute a DecorationSet that hides every top-level block outside the
 *  viewport band. Reads geometry (forces a layout) — scroll-gated, not
 *  keystroke-gated, so it does not inflate typing latency. */
function computeHiddenSet(view: EditorView): DecorationSet {
  if (!flags().virtualize) return DecorationSet.empty;
  const scroller = view.dom.closest<HTMLElement>(".editor-area-scroll");
  if (!scroller) return DecorationSet.empty;

  const sRect = scroller.getBoundingClientRect();
  const bandTop = sRect.top - BUFFER_PX;
  const bandBottom = sRect.bottom + BUFFER_PX;

  const decos: Decoration[] = [];
  const { doc } = view.state;
  doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const r = dom.getBoundingClientRect();
    // Off-screen (fully above or fully below the band) → hide it but reserve
    // its current height so the scrollbar/offset stays stable.
    if (r.bottom < bandTop || r.top > bandBottom) {
      const h = Math.max(1, Math.round(r.height));
      decos.push(
        Decoration.node(offset, offset + node.nodeSize, {
          style: `content-visibility:hidden;contain-intrinsic-size:auto ${h}px;`,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decos);
}

export const ViewportVirtualize = Extension.create({
  name: "viewportVirtualize",

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: viewportVirtualizeKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(viewportVirtualizeKey);
            // Scroll handler computed a fresh window.
            if (meta instanceof DecorationSet) return meta;
            // Pre-reveal shim: drop all hiding so posAtCoords sees real DOM.
            if (meta === "reveal") return DecorationSet.empty;
            // Otherwise keep the current window, mapped through doc edits so
            // typing does NOT re-lay-out the hidden blocks.
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return viewportVirtualizeKey.getState(state);
          },
          handleDOMEvents: {
            mousedown(view) {
              const f = flags();
              if (!f.virtualize || f.shim === false) return false;
              // Reveal everything before the click's posAtCoords runs, then
              // re-virtualize on the next frame.
              view.dispatch(
                view.state.tr.setMeta(viewportVirtualizeKey, "reveal"),
              );
              requestAnimationFrame(() => recompute(view));
              return false;
            },
          },
        },
        view(editorView) {
          const scroller = editorView.dom.closest<HTMLElement>(
            ".editor-area-scroll",
          );
          let raf = 0;
          const onScroll = () => {
            if (!flags().virtualize) return;
            if (raf) return;
            raf = requestAnimationFrame(() => {
              raf = 0;
              recompute(editorView);
            });
          };
          scroller?.addEventListener("scroll", onScroll, { passive: true });
          // Defer the first compute so initial layout has settled.
          const initRaf = requestAnimationFrame(onScroll);
          return {
            destroy() {
              scroller?.removeEventListener("scroll", onScroll);
              if (raf) cancelAnimationFrame(raf);
              cancelAnimationFrame(initRaf);
            },
          };
        },
      }),
    ];
  },
});

/** Recompute the hidden window and install it via a no-doc-change transaction. */
function recompute(view: EditorView): void {
  if (view.isDestroyed) return;
  const set = computeHiddenSet(view);
  view.dispatch(view.state.tr.setMeta(viewportVirtualizeKey, set));
}
