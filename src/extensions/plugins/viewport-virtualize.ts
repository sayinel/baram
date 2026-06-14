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
//   window.__baramFlags = { virtualize: true };             // enable
//   window.__baramFlags = { virtualize: true, shim: false };// un-shimmed click (plan §12 AM-5)
//   window.__baramFlags = {};                               // disable (re-renders all on next scroll)
// Then scroll once (first window compute) and measure typing via __baramPerf
// (avgTxMs OFF vs ON) and a timed click into an off-screen region.
//
// Loop-safety (v2): heights are measured ONCE per doc-structure and cached by
// block index; a window is recomputed from scrollTop arithmetic (no per-scroll
// rect reads), and a decoration dispatch happens ONLY when the visible index
// window actually changes. With contain-intrinsic-size = cached real height the
// total document height is preserved, so applying the hide does not shift
// scrollTop — which is what made v1 feed back into an infinite recompute loop.
//
// Throwaway measurement scaffolding; production design in
// docs/plans/2026-06-13-large-file-perf-c4-virtualization-plan.md.
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
            if (meta instanceof DecorationSet) return meta; // fresh window
            if (meta === "reveal") return DecorationSet.empty; // shim
            // Map the current window through edits so typing does NOT
            // re-lay-out the hidden blocks.
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return viewportVirtualizeKey.getState(state);
          },
        },
        view(editorView) {
          const scroller = editorView.dom.closest<HTMLElement>(
            ".editor-area-scroll",
          );

          // Cached per-block-index geometry (measured once per doc structure).
          let tops: number[] = [];
          let heights: number[] = [];
          let measuredFor = -1; // doc.childCount the cache was built for
          let lastFirst = -1;
          let lastLast = -1;
          let raf = 0;

          /** Measure each top-level block's height + cumulative top, once. */
          const measure = (): void => {
            tops = [];
            heights = [];
            let acc = 0;
            const { doc } = editorView.state;
            doc.forEach((_node, offset) => {
              const dom = editorView.nodeDOM(offset);
              const h = dom instanceof HTMLElement ? dom.offsetHeight : 0;
              tops.push(acc);
              heights.push(h);
              acc += h;
            });
            measuredFor = doc.childCount;
          };

          const clearWindow = (): void => {
            lastFirst = -1;
            lastLast = -1;
            if (!editorView.isDestroyed) {
              editorView.dispatch(
                editorView.state.tr.setMeta(
                  viewportVirtualizeKey,
                  DecorationSet.empty,
                ),
              );
            }
          };

          const recompute = (): void => {
            if (editorView.isDestroyed || !scroller) return;
            if (!flags().virtualize) {
              if (lastFirst !== -1) clearWindow();
              return;
            }
            const { doc } = editorView.state;
            // (Re)measure only when the block COUNT changes — never per scroll
            // and never per keystroke (single-char edits keep the count).
            if (doc.childCount !== measuredFor) measure();
            if (heights.length === 0) return;

            const top = scroller.scrollTop - BUFFER_PX;
            const bottom =
              scroller.scrollTop + scroller.clientHeight + BUFFER_PX;

            let first = 0;
            for (let i = 0; i < heights.length; i++) {
              if (tops[i] + heights[i] >= top) {
                first = i;
                break;
              }
            }
            let last = heights.length - 1;
            for (let i = heights.length - 1; i >= 0; i--) {
              if (tops[i] <= bottom) {
                last = i;
                break;
              }
            }

            // CHANGE-GUARD: only dispatch when the visible window moved. This is
            // what stops the recompute→dispatch→scroll feedback loop.
            if (first === lastFirst && last === lastLast) return;
            lastFirst = first;
            lastLast = last;

            const decos: Decoration[] = [];
            let idx = 0;
            doc.forEach((node, offset) => {
              if (idx < first || idx > last) {
                const h = Math.max(1, Math.round(heights[idx] || 1));
                decos.push(
                  Decoration.node(offset, offset + node.nodeSize, {
                    style: `content-visibility:hidden;contain-intrinsic-size:auto ${h}px;`,
                  }),
                );
              }
              idx++;
            });
            editorView.dispatch(
              editorView.state.tr.setMeta(
                viewportVirtualizeKey,
                DecorationSet.create(doc, decos),
              ),
            );
          };

          const scheduleRecompute = (): void => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
              raf = 0;
              recompute();
            });
          };

          // Click pre-reveal shim: reveal all before PM's posAtCoords, then
          // re-virtualize next frame. Capture phase so it runs before PM.
          const onMouseDown = (): void => {
            const f = flags();
            if (!f.virtualize || f.shim === false) return;
            if (lastFirst === -1) return; // nothing hidden
            editorView.dispatch(
              editorView.state.tr.setMeta(viewportVirtualizeKey, "reveal"),
            );
            lastFirst = -1;
            lastLast = -1;
            requestAnimationFrame(scheduleRecompute);
          };

          scroller?.addEventListener("scroll", scheduleRecompute, {
            passive: true,
          });
          editorView.dom.addEventListener("mousedown", onMouseDown, {
            capture: true,
          });
          const initRaf = requestAnimationFrame(scheduleRecompute);

          return {
            destroy() {
              scroller?.removeEventListener("scroll", scheduleRecompute);
              editorView.dom.removeEventListener("mousedown", onMouseDown, {
                capture: true,
              });
              if (raf) cancelAnimationFrame(raf);
              cancelAnimationFrame(initRaf);
            },
          };
        },
      }),
    ];
  },
});
