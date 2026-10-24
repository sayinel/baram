// §394 spec 0073 D14 · §7 "계획 B" · plan 0126 P4 · P24 · P31 — drawing a sandboxed panel: counts, not
// timings. `prepareDrawable` is wrapped in a `vi.fn` that calls the real one, so each draw is counted
// where the sanitizing happens — the step a code block's render takes (`drawable.test.ts`).
import type { PanelPaintState } from "../panel-painter";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../drawable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../drawable")>();
  return { ...actual, prepareDrawable: vi.fn(actual.prepareDrawable) };
});

import { prepareDrawable } from "../drawable";
import { PANEL_UPDATE_INTERVAL_MS } from "../limits";
import {
  __resetPanelContents,
  openPanel,
  setPanelContent,
} from "../panel-contents";
import { paintPanel } from "../panel-painter";

const KEY = "sb:live";
const REFUSED = "rendered CSS was refused (selectorNotAllowed)";

/** A shadow root painted from panel KEY, and every state the painter reported. */
function painted() {
  const shadow = document.createElement("div").attachShadow({ mode: "open" });
  const states: PanelPaintState[] = [];
  const stop = paintPanel(KEY, shadow, (state) => void states.push(state));
  return { shadow, states, stop };
}

const draws = () => vi.mocked(prepareDrawable).mock.calls.length;

beforeEach(() => {
  __resetPanelContents();
  openPanel(KEY);
  vi.mocked(prepareDrawable).mockClear();
});
afterEach(() => vi.useRealTimers());

describe("paintPanel", () => {
  /** §7 B — a panel's draw takes the code block's sanitizing step, once per draw, under its own
   *  owner name. What fails this: a panel that sanitizes by a path of its own (the count stays 0),
   *  or one that does not sanitize (the script is drawn). */
  it("draws through prepareDrawable, sanitized", () => {
    setPanelContent(KEY, { html: "<p>x</p><script>y()</script>" });
    const { shadow, states } = painted();
    expect(draws()).toBe(1);
    expect(vi.mocked(prepareDrawable)).toHaveBeenCalledWith(
      "[PluginPanel] sb:live",
      { html: "<p>x</p><script>y()</script>" },
    );
    expect(shadow.innerHTML).toBe("<p>x</p>");
    expect(states).toEqual([{ kind: "drawn" }]);
  });

  /** D14 "초당 4번" · P4 · P24 — twenty updates in one interval are drawn twice: the first at once and
   *  the last at the interval's end, then nothing. What fails this: drawing every update (20), only
   *  the leading edge (the last is never drawn), or only the trailing one (nothing at once). */
  it("draws a burst twice: the first at once, the last at the interval's end", () => {
    vi.useFakeTimers();
    const { shadow } = painted();
    expect(draws()).toBe(0);
    for (let i = 0; i < 20; i += 1)
      setPanelContent(KEY, { html: `<p>${i}</p>` });
    expect(draws()).toBe(1);
    expect(shadow.innerHTML).toBe("<p>0</p>");
    vi.advanceTimersByTime(PANEL_UPDATE_INTERVAL_MS - 1);
    expect(draws()).toBe(1);
    vi.advanceTimersByTime(1);
    expect(draws()).toBe(2);
    expect(shadow.innerHTML).toBe("<p>19</p>");
    vi.advanceTimersByTime(PANEL_UPDATE_INTERVAL_MS * 4);
    expect(draws()).toBe(2);
  });

  /** P4 — a steady stream: an update every 50 ms for a second is drawn at 0, 250, 500, 750 and
   *  1000 ms — five times, the last draw the last update. What fails this: a cooldown restarted by
   *  each update (a steady stream would never be drawn after the first). */
  it("draws a steady stream once per interval, ending on the last update", () => {
    vi.useFakeTimers();
    const { shadow } = painted();
    for (let i = 1; i <= 20; i += 1) {
      setPanelContent(KEY, { html: `<p>${i}</p>` });
      vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(PANEL_UPDATE_INTERVAL_MS);
    expect(draws()).toBe(5);
    expect(shadow.innerHTML).toBe("<p>20</p>");
  });

  /** D14 "보일 때 그린다" · P31 — content that arrived before the panel was painted is drawn once, the
   *  last of it. What fails this: a store that draws on receipt, or a painter that replays each kept
   *  update. */
  it("draws only the last of what arrived before it painted, once", () => {
    for (let i = 0; i < 3; i += 1)
      setPanelContent(KEY, { html: `<p>${i}</p>` });
    expect(draws()).toBe(0);
    const { shadow } = painted();
    expect(draws()).toBe(1);
    expect(shadow.innerHTML).toBe("<p>2</p>");
  });

  /** §6 · P8 — refused CSS reports the code block's sentence; a failure after a drawing keeps it,
   *  faded, and a failure with none drawn has nothing to fade. What fails this: a failure that clears
   *  the shadow root, or a `faded` that ignores whether anything was drawn. */
  it("keeps the last drawing, faded, when later content is refused", () => {
    vi.useFakeTimers();
    setPanelContent(KEY, { css: ":host{color:red}", html: "<p>bad</p>" });
    const { shadow, states } = painted();
    expect(states).toEqual([
      { faded: false, kind: "failed", message: REFUSED },
    ]);
    expect(shadow.innerHTML).toBe("");
    setPanelContent(KEY, { html: "<p>ok</p>" });
    vi.advanceTimersByTime(PANEL_UPDATE_INTERVAL_MS);
    setPanelContent(KEY, { css: ":host{color:red}", html: "<p>bad</p>" });
    vi.advanceTimersByTime(PANEL_UPDATE_INTERVAL_MS);
    expect(states.slice(1)).toEqual([
      { kind: "drawn" },
      { faded: true, kind: "failed", message: REFUSED },
    ]);
    expect(shadow.innerHTML).toBe("<p>ok</p>");
  });

  /** The stop function ends both ways a draw can start: the subscription and the timer. What fails
   *  this: a stop that keeps the subscription (the first half — stopped with no timer pending, the
   *  painter would draw the next content at once), or one that keeps the timer (the second half —
   *  stopped within an interval, the timer would draw what came meanwhile). The second half's first
   *  count is the pair: a painter that is not stopped draws. */
  it("draws nothing once stopped", () => {
    vi.useFakeTimers();
    painted().stop();
    setPanelContent(KEY, { html: "<p>1</p>" });
    expect(draws()).toBe(0);

    const { stop } = painted();
    expect(draws()).toBe(1);
    setPanelContent(KEY, { html: "<p>2</p>" });
    stop();
    vi.advanceTimersByTime(PANEL_UPDATE_INTERVAL_MS);
    setPanelContent(KEY, { html: "<p>3</p>" });
    expect(draws()).toBe(1);
  });
});
