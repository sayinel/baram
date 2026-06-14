// §perf-large-file C4 — Phase 0 SPIKE: block-level virtualization probe (v3).
//
// Evidence (window.__baramPerf, CONTEXT.md): ~97% of per-keystroke cost is
// WebKit layout/DOM, only ~3% is plugin apply. This probe tests whether hiding
// OFF-SCREEN top-level blocks (content-visibility:hidden + contain-intrinsic-
// size) removes them from the forced layout that typing triggers.
//
// WHY v3 IS IMPERATIVE (not Decoration-based): v1/v2 used ~3,400 Decoration.node
// entries. Typing mid-document shifts every decoration below the caret by one
// position, so ProseMirror re-applied inline style to thousands of DOM nodes per
// keystroke (the "decoration identity churn" class C3.1d already fought) — which
// froze typing and CONFOUNDED the test (we measured churn, not content-
// visibility). v3 toggles content-visibility directly on the off-screen block
// DOM, only when the visible window changes (scroll), and NEVER on a keystroke.
// PM re-renders only the edited (on-screen) block, so off-screen styles persist
// untouched → zero per-keystroke plugin work → a FAIR test of whether
// content-visibility:hidden actually helps WKWebView typing.
//
// SPIKE — DEV-only, OFF by default, does NOT use the doc/decorations at all.
// Toggle live in the DevTools console:
//   window.__baramFlags = { virtualize: true };   // enable
//   window.__baramFlags = {};                      // disable (reveals all)
// Then scroll once (first window compute) and measure typing via __baramPerf
// (avgTxMs OFF vs ON). If ON is still slow, content-visibility does not help on
// WKWebView → pivot to A1 (placeholder NodeView) or NO-GO.
//
// Throwaway measurement scaffolding; production design in
// docs/plans/2026-06-13-large-file-perf-c4-virtualization-plan.md.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const viewportVirtualizeKey = new PluginKey("viewportVirtualize");

interface VirtualizeFlags {
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
      new Plugin({
        key: viewportVirtualizeKey,
        view(editorView) {
          const scroller = editorView.dom.closest<HTMLElement>(
            ".editor-area-scroll",
          );

          // Cached per-block-index geometry (measured once per doc structure).
          let tops: number[] = [];
          let heights: number[] = [];
          let measuredFor = -1;
          let lastFirst = -1;
          let lastLast = -1;
          let raf = 0;
          const hidden = new Set<HTMLElement>();

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

          const showAll = (): void => {
            for (const el of hidden) {
              el.style.contentVisibility = "";
              el.style.containIntrinsicSize = "";
            }
            hidden.clear();
          };

          const recompute = (): void => {
            if (editorView.isDestroyed || !scroller) return;
            if (!flags().virtualize) {
              if (hidden.size > 0) showAll();
              lastFirst = -1;
              lastLast = -1;
              return;
            }
            const { doc } = editorView.state;
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

            // CHANGE-GUARD: only touch the DOM when the window moved. Typing
            // does not move it, so a keystroke does zero work here.
            if (first === lastFirst && last === lastLast) return;
            lastFirst = first;
            lastLast = last;

            // Rebuild the hidden set imperatively (no ProseMirror decorations →
            // no per-keystroke remap churn).
            showAll();
            let idx = 0;
            editorView.state.doc.forEach((_node, offset) => {
              if (idx < first || idx > last) {
                const el = editorView.nodeDOM(offset);
                if (el instanceof HTMLElement) {
                  const h = Math.max(1, Math.round(heights[idx] || 1));
                  el.style.contentVisibility = "hidden";
                  el.style.containIntrinsicSize = `auto ${h}px`;
                  hidden.add(el);
                }
              }
              idx++;
            });
          };

          const schedule = (): void => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
              raf = 0;
              recompute();
            });
          };

          scroller?.addEventListener("scroll", schedule, { passive: true });
          const initRaf = requestAnimationFrame(schedule);

          return {
            destroy() {
              scroller?.removeEventListener("scroll", schedule);
              if (raf) cancelAnimationFrame(raf);
              cancelAnimationFrame(initRaf);
              showAll();
            },
          };
        },
      }),
    ];
  },
});
