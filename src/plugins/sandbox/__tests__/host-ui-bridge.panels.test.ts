// §394 spec 0073 D14 · §6 · plan 0126 P4 · P8 · P23 · P34 — `ui_set_panel`, the host half of
// `ctx.ui.setPanel`. This realm does not trust the sandbox to have refused what these rows refuse.
import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_RENDERED_HTML_BYTES,
  PANEL_UPDATE_BURST,
  PANEL_UPDATE_INTERVAL_MS,
} from "../../rendered/limits";
import {
  __resetPanelContents,
  openPanel,
  panelContent,
  releasePanels,
} from "../../rendered/panel-contents";
import {
  closedPanelMessage,
  panelRateMessage,
} from "../../rendered/panel-messages";
import { createUIRequestHandler } from "../host-ui-bridge";

/** A ui handler for plugin `sb` with panels `live` and `other`, on the clock `now` (still, by default). */
function handler(
  capabilities: Parameters<typeof createUIRequestHandler>[0]["capabilities"] = [
    "sidebar",
  ],
  now: () => number = () => 0,
) {
  return createUIRequestHandler({
    capabilities,
    declaredPanelIds: ["live", "other"],
    declaredStatusBarIds: [],
    now,
    pluginId: "sb",
    pluginName: "SB",
  });
}

beforeEach(() => {
  __resetPanelContents();
  openPanel("sb:live");
  openPanel("sb:other");
});

describe("ui_set_panel", () => {
  /** P4 — kept as sent, so the `<script>` is still here. What fails this: a handler that sanitizes
   *  on receipt (each update of a panel nobody looks at would pay for it), or one that keeps
   *  nothing. */
  it("keeps a declared panel's content as it was sent", async () => {
    await handler()({
      css: "p{}",
      html: "<p>x</p><script>y()</script>",
      id: "live",
      kind: "ui_set_panel",
    });
    expect(panelContent("sb:live")?.content).toEqual({
      css: "p{}",
      html: "<p>x</p><script>y()</script>",
    });
  });

  /** §4 · D4 — `sidebar` opens it, and the gate is the bridge's own. */
  it("refuses a plugin without sidebar", async () => {
    await expect(
      handler(["statusbar"])({ html: "", id: "live", kind: "ui_set_panel" }),
    ).rejects.toThrow(/requires one of "sidebar" to call ui\.setPanel/);
    expect(panelContent("sb:live")).toBeNull();
  });

  /** §6 — the fixed sentence, naming the id. */
  it("refuses a panel the manifest does not declare", async () => {
    await expect(
      handler()({ html: "", id: "nope", kind: "ui_set_panel" }),
    ).rejects.toThrow(
      'ui.setPanel: panel "nope" is not declared in contributions.panels',
    );
  });

  /** §6 · P8 — the byte caps in UTF-8 and the lone surrogate, with a renderer's sentences. Hangul is
   *  three UTF-8 bytes a character, so this HTML passes the validator's UTF-16 floor and only the
   *  byte count refuses it. What fails this: no `renderedContentProblem` in the handler. */
  it("refuses content over a byte cap or holding a lone surrogate", async () => {
    const wide = "가".repeat(Math.floor(MAX_RENDERED_HTML_BYTES / 3) + 1);
    expect(wide.length).toBeLessThanOrEqual(MAX_RENDERED_HTML_BYTES);
    await expect(
      handler()({ html: wide, id: "live", kind: "ui_set_panel" }),
    ).rejects.toThrow(
      `rendered output exceeds ${MAX_RENDERED_HTML_BYTES} bytes of HTML`,
    );
    await expect(
      handler()({ html: "\uD800", id: "live", kind: "ui_set_panel" }),
    ).rejects.toThrow(/lone surrogate/);
    expect(panelContent("sb:live")).toBeNull();
  });

  /** P14 · P23 — a request that arrives after the plugin's panels were released writes nothing back.
   *  The pair is the first row. */
  it("refuses a panel that is not open", async () => {
    releasePanels("sb");
    await expect(
      handler()({ html: "<p>late</p>", id: "live", kind: "ui_set_panel" }),
    ).rejects.toThrow(closedPanelMessage("live"));
    expect(panelContent("sb:live")).toBeNull();
  });
});

describe("ui_set_panel — the acceptance bound (plan 0126 P34)", () => {
  /** A handler on a clock the test moves, and a write of panel `id`. Writes accepted = `seq`. */
  function clocked() {
    let clock = 1_000;
    const h = handler(["sidebar"], () => clock);
    return {
      advance: (ms: number) => {
        clock += ms;
      },
      write: (id = "live") => h({ html: "<p>x</p>", id, kind: "ui_set_panel" }),
    };
  }

  const accepted = (key = "sb:live") => panelContent(key)?.seq ?? 0;

  /** The boundary. What fails this: no bound (the ninth is kept), a bucket that never refills (the
   *  write an interval later is refused too), or one that counts fractions (the write one
   *  millisecond short of the interval is kept). A bucket that keeps a clock of its own fails at the
   *  write one interval later, not at the write 1 ms short: its anchor is not the request clock the
   *  test moves, so the refill never arrives. */
  it("accepts a burst of eight, refuses the ninth, and takes one more an interval later", async () => {
    const { advance, write } = clocked();
    for (let i = 0; i < PANEL_UPDATE_BURST; i += 1) await write();
    expect(accepted()).toBe(PANEL_UPDATE_BURST);
    await expect(write()).rejects.toThrow(panelRateMessage("live"));
    advance(PANEL_UPDATE_INTERVAL_MS - 1);
    await expect(write()).rejects.toThrow(panelRateMessage("live"));
    advance(1);
    await write();
    expect(accepted()).toBe(PANEL_UPDATE_BURST + 1);
    await expect(write()).rejects.toThrow(panelRateMessage("live"));
  });

  /** The pair of the row above, and the pace a client would keep (P34): one write per interval on
   *  average is never refused — steady, or with delivery jitter in gaps of 3/5, 3/5 and 9/5 of an
   *  interval. What fails this: a burst too small for jitter (a burst of one refuses the first
   *  jittered write), or a bucket that drops the part of an interval it has not yet turned into a
   *  token (`bucket.at = at` on every refill) — the refills here fall between interval marks, and
   *  that bucket refuses the 23rd jittered write (re-review N2; scratchpad `p0126/sim/bucket.mjs`). */
  it("never refuses one write per interval, steady or jittered", async () => {
    const { advance, write } = clocked();
    for (let i = 0; i < 40; i += 1) {
      await write();
      advance(PANEL_UPDATE_INTERVAL_MS);
    }
    const gaps = [
      (PANEL_UPDATE_INTERVAL_MS * 3) / 5,
      (PANEL_UPDATE_INTERVAL_MS * 3) / 5,
      (PANEL_UPDATE_INTERVAL_MS * 9) / 5,
    ];
    for (let i = 0; i < 60; i += 1) {
      await write();
      advance(gaps[i % 3]);
    }
    expect(accepted()).toBe(100);
  });

  /** N3 — a clock that steps back (the default `now` is `Date.now`, a wall clock) costs at most the
   *  part of an interval not yet turned into a token: a client writing once per interval across a
   *  10-second step back is never refused. What fails this: no clamp — the bucket's anchor stays in the
   *  future, it earns nothing until the clock catches up, and the 8th write after the step is refused. */
  it("never refuses one write per interval across a backward clock step", async () => {
    const { advance, write } = clocked();
    for (let i = 0; i < 10; i += 1) {
      await write();
      advance(PANEL_UPDATE_INTERVAL_MS);
    }
    advance(-10_000);
    for (let i = 0; i < 40; i += 1) {
      await write();
      advance(PANEL_UPDATE_INTERVAL_MS);
    }
    expect(accepted()).toBe(50);
  });

  /** A bucket per panel. What fails this: one bucket for the plugin (`other` would be refused). */
  it("keeps a bucket per panel", async () => {
    const { write } = clocked();
    for (let i = 0; i < PANEL_UPDATE_BURST; i += 1) await write("live");
    await expect(write("live")).rejects.toThrow(panelRateMessage("live"));
    await write("other");
    expect(accepted("sb:other")).toBe(1);
  });

  /** The bound comes before any work on the content: content it then refuses has spent its token, so
   *  a plugin sending over-cap frames meets the bound, not an encoding pass for each. What fails this:
   *  the bucket checked after `renderedContentProblem`. */
  it("spends a token on content it then refuses", async () => {
    const h = handler(["sidebar"], () => 0);
    const wide = "가".repeat(Math.floor(MAX_RENDERED_HTML_BYTES / 3) + 1);
    for (let i = 0; i < PANEL_UPDATE_BURST; i += 1) {
      await expect(
        h({ html: wide, id: "live", kind: "ui_set_panel" }),
      ).rejects.toThrow(/exceeds/);
    }
    await expect(
      h({ html: "<p>x</p>", id: "live", kind: "ui_set_panel" }),
    ).rejects.toThrow(panelRateMessage("live"));
  });
});
