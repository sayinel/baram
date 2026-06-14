// §perf-large-file C4 — A1 Phase 1: rendering-mechanism validation.
//
// Synthesis of everything the Phase 0 spike learned:
//  - DECORATION delivery (Decoration.node), NOT imperative el.style — so PM owns
//    the off-screen style and re-applies it on its own re-renders (fixes the v5
//    "imperative style clobbered when PM re-renders a block" failure).
//  - MAP, don't rebuild, during a typing burst — apply() returns old.map(...),
//    reusing the SAME Decoration objects, so PM sees them unchanged and does NOT
//    re-apply to the DOM (fixes the v1/v2 "rebuild every keystroke → churn → froze"
//    failure). The window is rebuilt only at burst start / on genuine scroll.
//  - VIRTUALIZE ONLY WHILE TYPING — empty decorations when idle/scrolling, so
//    scrolling is over fully-laid-out content (native fast); the off-screen-hide
//    cost is paid only during typing, where it buys the win (fixes the
//    "virtualization trades typing speed for scroll speed" trade-off).
//  - CACHED heights (measured once) so building the window does not force a full
//    layout on the first keystroke of a burst.
//
// SPIKE/validation — DEV-only, OFF by default. Toggle:
//   window.__baramFlags = { virtualize: true };  // enable
//   window.__baramFlags = {};                     // disable (reveals all)
// If this gives fast typing AND fast scrolling, it is the production mechanism
// (then: settings flag, export-suspend, click/nav reveal — plan Phase 1-4).
// Plan: docs/plans/2026-06-13-large-file-perf-c4-virtualization-plan.md.
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const viewportVirtualizeKey = new PluginKey<DecorationSet>(
  "viewportVirtualize",
);

function flagOn(): boolean {
  if (!import.meta.env.DEV) return false;
  return !!(globalThis as { __baramFlags?: { virtualize?: boolean } })
    .__baramFlags?.virtualize;
}

/** Render the viewport plus this much above/below (px). */
const BUFFER_PX = 1200;
/** Reveal everything this long after the last keystroke. */
const IDLE_MS = 400;

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
            if (meta instanceof DecorationSet) return meta; // rebuilt window
            if (meta === "clear") return DecorationSet.empty; // reveal all
            // Typing/selection: MAP only (reuse Decoration objects) so PM does
            // not re-apply → no per-keystroke churn.
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

          let tops: number[] = [];
          let heights: number[] = [];
          let measuredFor = -1;
          let typing = false;
          let idleTimer = 0;
          let scrollRaf = 0;

          const measure = (): void => {
            tops = [];
            heights = [];
            let acc = 0;
            editorView.state.doc.forEach((_node, offset) => {
              const dom = editorView.nodeDOM(offset);
              const h = dom instanceof HTMLElement ? dom.offsetHeight : 0;
              tops.push(acc);
              heights.push(h);
              acc += h;
            });
            measuredFor = editorView.state.doc.childCount;
          };

          const ensureMeasured = (): void => {
            if (editorView.state.doc.childCount !== measuredFor) measure();
          };

          /** Build the hidden-window DecorationSet from cached geometry +
           *  current scrollTop (no per-build layout read). */
          const buildWindow = (): DecorationSet => {
            if (!scroller || heights.length === 0) return DecorationSet.empty;
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
            const decos: Decoration[] = [];
            let idx = 0;
            editorView.state.doc.forEach((node, offset) => {
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
            return DecorationSet.create(editorView.state.doc, decos);
          };

          const setWindow = (): void => {
            if (editorView.isDestroyed) return;
            editorView.dispatch(
              editorView.state.tr.setMeta(viewportVirtualizeKey, buildWindow()),
            );
          };

          const clearWindow = (): void => {
            if (editorView.isDestroyed) return;
            const cur = viewportVirtualizeKey.getState(editorView.state);
            if (cur && cur !== DecorationSet.empty) {
              editorView.dispatch(
                editorView.state.tr.setMeta(viewportVirtualizeKey, "clear"),
              );
            }
          };

          const exitTyping = (): void => {
            if (!typing) return;
            typing = false;
            clearWindow();
          };

          const onKeyDown = (): void => {
            if (!flagOn()) return;
            if (!typing) {
              ensureMeasured();
              typing = true;
              setWindow();
            }
            window.clearTimeout(idleTimer);
            idleTimer = window.setTimeout(exitTyping, IDLE_MS);
          };

          const onScroll = (): void => {
            if (!flagOn()) {
              exitTyping();
              return;
            }
            // Pre-warm height cache so the first keystroke is cheap.
            if (scrollRaf) return;
            scrollRaf = requestAnimationFrame(() => {
              scrollRaf = 0;
              ensureMeasured();
              // While typing, follow the caret; idle scrolling keeps everything
              // revealed (native fast scroll), so do nothing.
              if (typing) setWindow();
            });
          };

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
            },
          };
        },
      }),
    ];
  },
});
