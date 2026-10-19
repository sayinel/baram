// §394 spec 0073 D14 · plan 0126 P4 · P24 · P31 — drawing one sandboxed panel's content into its shadow
// root, at most once per `PANEL_UPDATE_INTERVAL_MS`: content that arrives while no draw has happened
// for an interval is drawn at once, and content that arrives within an interval after a draw waits for
// the interval's end, where the newest of it is drawn once. No clock is read — a draw starts a timer,
// and what came meanwhile is drawn when it fires.
//
// The painter runs only while the panel's view is mounted, and the view is mounted only while the
// panel is on screen: closing the sidebar unmounts `Sidebar` (`AppLayout.tsx` renders it only while
// open), another seat unmounts the plugin seat (`Sidebar.tsx`), and another plugin panel replaces this
// one (`PluginPanelHost`'s `key`). So content that arrives while the panel is not shown is only kept
// (`panel-contents.ts`), and the painter draws the newest of it when the view mounts. Every draw goes
// through `prepareDrawable` — the step a code block's result takes (spec §7 "계획 B").

import { sanitizePluginText } from "../plugin-text";
import { prepareDrawable, refusedCssMessage } from "./drawable";
import { MAX_RENDER_ERROR_CHARS, PANEL_UPDATE_INTERVAL_MS } from "./limits";
import { panelContent, subscribePanel } from "./panel-contents";
import { drawRendered } from "./rendered-body";
import { PluginCssError } from "./sanitize-css";

/** What a panel's view shows around the drawing (`RenderedPanelView`). */
export type PanelPaintState =
  | { faded: boolean; kind: "failed"; message: string }
  | { kind: "drawn" }
  | { kind: "empty" };

/** The error line's text for a draw that threw something other than refused CSS and gave no message. */
const DRAW_FAILED = "the panel could not be drawn";

/**
 * Draw panel `key`'s content into `shadow` now and whenever it changes, at most once per
 * `PANEL_UPDATE_INTERVAL_MS`, telling `onState` what to show around it. `failed` is `faded` when an
 * earlier drawing stays under the error line. Returns the stop function.
 */
export function paintPanel(
  key: string,
  shadow: ShadowRoot,
  onState: (state: PanelPaintState) => void,
): () => void {
  let drawnSeq = 0;
  let drewOnce = false;
  let cooling: null | ReturnType<typeof setTimeout> = null;
  let due = false;

  /** Draw the newest content if it is new; whether there was new content to draw. */
  function draw(): boolean {
    const current = panelContent(key);
    if (current === null || current.seq === drawnSeq) return false;
    drawnSeq = current.seq;
    try {
      const prepared = prepareDrawable(`[PluginPanel] ${key}`, current.content);
      if (typeof prepared === "string") {
        onState({ faded: drewOnce, kind: "failed", message: prepared });
      } else {
        drawRendered(shadow, prepared.content);
        drewOnce = true;
        onState({ kind: "drawn" });
      }
    } catch (err) {
      onState({ faded: drewOnce, kind: "failed", message: failureText(err) });
    }
    return true;
  }

  /** The interval after a draw is over: draw what came meanwhile, if anything did. */
  function cool(): void {
    cooling = null;
    if (!due) return;
    due = false;
    schedule();
  }

  /** New content, or the first look: draw now unless an interval is running, else at its end. */
  function schedule(): void {
    if (cooling !== null) {
      due = true;
      return;
    }
    if (draw()) cooling = setTimeout(cool, PANEL_UPDATE_INTERVAL_MS);
  }

  const unsubscribe = subscribePanel(key, schedule);
  schedule();
  return () => {
    unsubscribe();
    if (cooling !== null) clearTimeout(cooling);
  };
}

/**
 * A throwing draw's sentence: refused CSS names its rule (plan 0125 P9); otherwise the error's own
 * message — the markup sanitizer's node cap — flattened and capped as a block's is (D10); else fixed.
 */
function failureText(err: unknown): string {
  if (err instanceof PluginCssError) return refusedCssMessage(err);
  const message =
    err instanceof Error
      ? sanitizePluginText(err.message, MAX_RENDER_ERROR_CHARS)
      : "";
  return message || DRAW_FAILED;
}
