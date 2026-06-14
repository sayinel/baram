// §perf-large-file C4 — Phase 0 SPIKE: block-level virtualization probe (v5).
//
// Phase 0 found a TRADE-OFF on WKWebView:
//   - all blocks laid out (OFF) → scrolling is cheap (compositor only), but every
//     keystroke re-lays-out all ~3,500 blocks → typing ~467ms.
//   - off-screen hidden (always-ON) → typing ~28ms, but scrolling must lay out
//     blocks as they enter → slow scroll.
// The two costs happen at DIFFERENT times, so v5 virtualizes ONLY WHILE TYPING:
//   - keydown → enter typing mode → hide off-screen blocks (cheap; subsequent
//     keystrokes lay out only the visible window → fast typing).
//   - 400ms idle (or flag off) → exit → reveal all → free, fast scrolling.
//   - while typing, scroll/caret-scroll recomputes the window (delta) so the
//     hidden band follows the caret.
// Heights are measured once (cached) so the first keystroke does not pay for it
// (a scroll after enabling pre-warms the cache).
//
// Hiding is applied IMPERATIVELY (not PM Decoration.node, which remaps ~3,400
// nodes per keystroke → froze v1/v2). SPIKE: DEV-only, OFF by default.
//   window.__baramFlags = { virtualize: true };   // enable
//   window.__baramFlags = {};                      // disable (reveals all)
//
// Throwaway measurement scaffolding; production design + remaining risks in
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
const BUFFER_PX = 1200;
/** Reveal everything this long after the last keystroke. */
const IDLE_MS = 400;

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

          let tops: number[] = [];
          let heights: number[] = [];
          let els: (HTMLElement | null)[] = [];
          let hiddenFlag: boolean[] = [];
          let measuredFor = -1;
          let lastFirst = -1;
          let lastLast = -1;
          let typingMode = false;
          let idleTimer = 0;
          let scrollRaf = 0;

          function show(i: number): void {
            const el = els[i];
            if (!el || !hiddenFlag[i]) return;
            el.style.contentVisibility = "";
            el.style.containIntrinsicSize = "";
            hiddenFlag[i] = false;
          }

          function revealAll(): void {
            for (let i = 0; i < els.length; i++) show(i);
            lastFirst = -1;
            lastLast = -1;
          }

          function hide(i: number): void {
            const el = els[i];
            if (!el || hiddenFlag[i]) return;
            el.style.contentVisibility = "hidden";
            el.style.containIntrinsicSize = `auto ${Math.max(1, Math.round(heights[i] || 1))}px`;
            hiddenFlag[i] = true;
          }

          /** Measure heights + cache element refs once per doc structure. Reveals
           *  any current hiding first so the read sees real heights. */
          function measure(): void {
            revealAll();
            tops = [];
            heights = [];
            els = [];
            hiddenFlag = [];
            let acc = 0;
            editorView.state.doc.forEach((_node, offset) => {
              const dom = editorView.nodeDOM(offset);
              const el = dom instanceof HTMLElement ? dom : null;
              const h = el ? el.offsetHeight : 0;
              tops.push(acc);
              heights.push(h);
              els.push(el);
              hiddenFlag.push(false);
              acc += h;
            });
            measuredFor = editorView.state.doc.childCount;
          }

          function ensureMeasured(): void {
            if (editorView.state.doc.childCount !== measuredFor) measure();
          }

          /** Hide everything outside the viewport band; delta-toggle only the
           *  elements whose state flips. Only runs in typing mode. */
          function recomputeWindow(): void {
            if (editorView.isDestroyed || !scroller || heights.length === 0)
              return;
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
            if (first === lastFirst && last === lastLast) return;
            lastFirst = first;
            lastLast = last;
            for (let i = 0; i < els.length; i++) {
              if (i < first || i > last) hide(i);
              else show(i);
            }
          }

          function exitTyping(): void {
            if (!typingMode) return;
            typingMode = false;
            revealAll();
          }

          function onKeyDown(): void {
            if (!flags().virtualize) return;
            if (!typingMode) {
              ensureMeasured();
              typingMode = true;
              recomputeWindow();
            }
            window.clearTimeout(idleTimer);
            idleTimer = window.setTimeout(exitTyping, IDLE_MS);
          }

          function onScroll(): void {
            // Pre-warm the height cache when enabled so the first keystroke is
            // fast; follow the caret while typing. Idle scrolling does nothing
            // (everything is revealed → native fast scroll).
            if (!flags().virtualize) {
              if (typingMode) exitTyping();
              return;
            }
            if (scrollRaf) return;
            scrollRaf = requestAnimationFrame(() => {
              scrollRaf = 0;
              ensureMeasured();
              if (typingMode) recomputeWindow();
            });
          }

          editorView.dom.addEventListener("keydown", onKeyDown, {
            capture: true,
          });
          scroller?.addEventListener("scroll", onScroll, { passive: true });
          const initRaf = requestAnimationFrame(onScroll);

          return {
            destroy() {
              editorView.dom.removeEventListener("keydown", onKeyDown, {
                capture: true,
              });
              scroller?.removeEventListener("scroll", onScroll);
              window.clearTimeout(idleTimer);
              if (scrollRaf) cancelAnimationFrame(scrollRaf);
              cancelAnimationFrame(initRaf);
              revealAll();
            },
          };
        },
      }),
    ];
  },
});
