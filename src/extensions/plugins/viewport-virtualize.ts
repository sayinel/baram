// §perf-large-file C4 — Phase 0 SPIKE: block-level virtualization probe (v4).
//
// Phase 0 GO result: hiding off-screen top-level blocks with
// content-visibility:hidden + contain-intrinsic-size drops large-file typing
// from ~467ms to ~28ms/tx on WKWebView (CONTEXT.md). Confirmed content-
// visibility DOES exclude off-screen subtrees from the typing-path forced
// layout. The win only appears when hiding is applied imperatively (PM
// Decoration.node remap churns thousands of nodes per keystroke and froze v1/v2).
//
// v4 fixes SCROLL: v3 revealed ALL blocks then re-hid them on every window
// change (a full-document layout storm per scroll frame → slow scroll, blank
// gaps). v4 caches block element refs at measure time and toggles ONLY the
// blocks that crossed the viewport boundary (delta), so a scroll frame touches a
// handful of elements, not ~3,400.
//
// SPIKE — DEV-only, OFF by default, no doc/decorations. Toggle in console:
//   window.__baramFlags = { virtualize: true };   // enable
//   window.__baramFlags = {};                      // disable (reveals all)
//
// Throwaway measurement scaffolding; production design + remaining risks (click/
// nav reveal, export-suspend, fold compose, NodeView lazy-mount, accessibility)
// in docs/plans/2026-06-13-large-file-perf-c4-virtualization-plan.md.
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
const BUFFER_PX = 1200;

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

          // Per-block-index caches, measured once per doc structure.
          let tops: number[] = [];
          let heights: number[] = [];
          let els: (HTMLElement | null)[] = [];
          let hiddenFlag: boolean[] = [];
          let measuredFor = -1;
          let lastFirst = -1;
          let lastLast = -1;
          let raf = 0;

          const measure = (): void => {
            // Reveal anything currently hidden before re-measuring real heights.
            revealAll();
            tops = [];
            heights = [];
            els = [];
            hiddenFlag = [];
            let acc = 0;
            const { doc } = editorView.state;
            doc.forEach((_node, offset) => {
              const dom = editorView.nodeDOM(offset);
              const el = dom instanceof HTMLElement ? dom : null;
              const h = el ? el.offsetHeight : 0;
              tops.push(acc);
              heights.push(h);
              els.push(el);
              hiddenFlag.push(false);
              acc += h;
            });
            measuredFor = doc.childCount;
          };

          function hide(i: number): void {
            const el = els[i];
            if (!el || hiddenFlag[i]) return;
            const h = Math.max(1, Math.round(heights[i] || 1));
            el.style.contentVisibility = "hidden";
            el.style.containIntrinsicSize = `auto ${h}px`;
            hiddenFlag[i] = true;
          }

          function show(i: number): void {
            const el = els[i];
            if (!el || !hiddenFlag[i]) return;
            el.style.contentVisibility = "";
            el.style.containIntrinsicSize = "";
            hiddenFlag[i] = false;
          }

          function revealAll(): void {
            for (let i = 0; i < els.length; i++) show(i);
          }

          const recompute = (): void => {
            if (editorView.isDestroyed || !scroller) return;
            if (!flags().virtualize) {
              if (lastFirst !== -1) {
                revealAll();
                lastFirst = -1;
                lastLast = -1;
              }
              return;
            }
            if (editorView.state.doc.childCount !== measuredFor) measure();
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

            // CHANGE-GUARD: only act when the window moved.
            if (first === lastFirst && last === lastLast) return;
            lastFirst = first;
            lastLast = last;

            // DELTA: iterate all indices (cheap array loop, no DOM reads) but
            // only WRITE the few elements whose hidden-state actually flips.
            for (let i = 0; i < els.length; i++) {
              if (i < first || i > last) hide(i);
              else show(i);
            }
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
              revealAll();
            },
          };
        },
      }),
    ];
  },
});
