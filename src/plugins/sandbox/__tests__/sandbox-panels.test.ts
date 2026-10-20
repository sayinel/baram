// §394 spec 0073 §4 · D13 · D14 · plan 0126 P4 · P8 · P11 · P12 · P13 · P14 — the sandboxed tier's
// panels, run through the real client and session over the in-memory channel pair: `setPanel` refuses
// at once what the host would refuse, sends one update per panel at a time with the last one winning,
// and is gated on `sidebar` by the host; `onPanelAction` runs that panel's handlers under prompt rights;
// a released panel and a disposed session write nothing.
import type { PluginCapability, SandboxContext } from "../../types";
import type { HostRequestHandler } from "../sandbox-session";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../../../utils/logger";
import { promptRefusal, resetPromptGate } from "../../prompt-gate";
import {
  MAX_RENDERED_HTML_BYTES,
  PANEL_UPDATE_INTERVAL_MS,
} from "../../rendered/limits";
import {
  __resetPanelContents,
  openPanel,
  panelContent,
  panelKey,
  releasePanels,
} from "../../rendered/panel-contents";
import {
  closedPanelMessage,
  panelRateMessage,
} from "../../rendered/panel-messages";
import {
  dispatchPanelAction,
  wireSandboxPanels,
} from "../../rendered/panels-host";
import { createHostRequestHandler } from "../host-request-router";
import { CALL_TIMEOUT_MS } from "../sandbox-calls";
import { startSandboxClient } from "../sandbox-client";
import { SandboxSession } from "../sandbox-session";
import { createChannelPair } from "./channel-pair";

const PANEL_IDS = ["live", "other"];

/**
 * Start a sandbox whose plugin runs `activate`, wired as `plugin-loader.ts` wires one with panels:
 * the panels open, their ids in the `activate` frame and the handler, the action delivery set. `sent`
 * records each `ui_set_panel` the host was asked for, in order. `now` is the host's clock — its
 * acceptance bucket's (P34); `Date.now` when absent. The host side's `close()` does nothing: the
 * pair's own clears its handlers, which would drop a frame sent after `dispose` before the session's
 * own guards could — and the dispose row is about those.
 */
async function start(
  activate: (ctx: SandboxContext) => void,
  capabilities: PluginCapability[] = ["sidebar"],
  now?: () => number,
) {
  const sent: Array<{ html: string; id: string }> = [];
  const pair = createChannelPair();
  const host = { ...pair.host, close: () => {} };
  startSandboxClient(
    pair.sandbox,
    async () => ({ activate }),
    async (op) => {
      if (op.kind === "source_read") return "// injected";
      throw new Error(`unexpected op ${op.kind}`);
    },
  );
  const services = createHostRequestHandler({
    capabilities,
    declaredPanelIds: PANEL_IDS,
    declaredSettings: [],
    declaredStatusBarIds: [],
    now,
    pluginId: "sb",
    pluginName: "SB",
  });
  const handler: HostRequestHandler = (request, onToken) => {
    if (request.kind === "ui_set_panel") {
      sent.push({ html: request.html, id: request.id });
    }
    return services(request, onToken);
  };
  const session = new SandboxSession(host, handler);
  for (const id of PANEL_IDS) openPanel(panelKey("sb", id));
  await session.activate("sb", {}, undefined, [...PANEL_IDS]);
  wireSandboxPanels("sb", session, []);
  return { sandbox: pair.sandbox, sent, session };
}

/** Let the in-memory channel carry a request and its answer: microtasks only, so it runs under fake timers too. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

beforeEach(() => __resetPanelContents());
afterEach(() => {
  resetPromptGate();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ctx.ui.setPanel (§4 · §6 · D14)", () => {
  /** The road end to end: client → `ui_set_panel` → the host's handler → the panel's store, as sent. */
  it("carries a declared panel's content to the host", async () => {
    let ctx!: SandboxContext;
    await start((c) => {
      ctx = c;
    });
    ctx.ui.setPanel("live", { css: "p{}", html: "<p>x</p>" });
    await vi.waitFor(() =>
      expect(panelContent("sb:live")?.content).toEqual({
        css: "p{}",
        html: "<p>x</p>",
      }),
    );
  });

  /** §6 · P8 · P11 — refused at once in the sandbox, from the `activate` frame's ids and the result
   *  limits, with the host's sentences; nothing crosses. What fails this: a client that sends and
   *  leaves the refusal to the host (the call returns, the error lands in a log). The pair is the row
   *  above. */
  it("throws at once for an undeclared id or content over a limit, and sends nothing", async () => {
    let ctx!: SandboxContext;
    const { sent } = await start((c) => {
      ctx = c;
    });
    expect(() => ctx.ui.setPanel("nope", { html: "" })).toThrow(
      'ui.setPanel: panel "nope" is not declared in contributions.panels',
    );
    expect(() => ctx.ui.onPanelAction("nope", () => {})).toThrow(
      'ui.onPanelAction: panel "nope" is not declared in contributions.panels',
    );
    expect(() =>
      ctx.ui.setPanel("live", {
        html: "가".repeat(Math.floor(MAX_RENDERED_HTML_BYTES / 3) + 1),
      }),
    ).toThrow(
      `rendered output exceeds ${MAX_RENDERED_HTML_BYTES} bytes of HTML`,
    );
    expect(() => ctx.ui.setPanel("live", { html: "\uD800" })).toThrow(
      /lone surrogate/,
    );
    await flush();
    expect(sent).toEqual([]);
  });

  /** D14 · P4 · P24 — one update per panel on its way, the next starting an interval after the one
   *  before, the last call winning; one panel's interval does not hold another's. What fails this: a
   *  client that sends every call (twenty sends), drops the last (the second send is `<p>1</p>`), or
   *  keeps one queue for all panels (`other` waits for `live`). */
  it("sends one update per panel at a time, an interval apart, the last call winning", async () => {
    let ctx!: SandboxContext;
    const { sent } = await start((c) => {
      ctx = c;
    });
    vi.useFakeTimers();
    const live = () => sent.filter((s) => s.id === "live").map((s) => s.html);
    for (let i = 0; i < 20; i += 1) {
      ctx.ui.setPanel("live", { html: `<p>${i}</p>` });
    }
    await flush();
    expect(live()).toEqual(["<p>0</p>"]);
    ctx.ui.setPanel("other", { html: "<p>other</p>" });
    await flush();
    expect(sent.filter((s) => s.id === "other")).toHaveLength(1);
    vi.advanceTimersByTime(PANEL_UPDATE_INTERVAL_MS - 1);
    await flush();
    expect(live()).toEqual(["<p>0</p>"]);
    vi.advanceTimersByTime(1);
    await flush();
    expect(live()).toEqual(["<p>0</p>", "<p>19</p>"]);
    vi.advanceTimersByTime(PANEL_UPDATE_INTERVAL_MS * 4);
    await flush();
    expect(live()).toHaveLength(2);
    expect(panelContent("sb:live")?.content.html).toBe("<p>19</p>");
  });

  /** P34 — the client's pace is inside the host's acceptance bucket: a plugin calling `setPanel` twenty
   *  times a second for five seconds is never refused, and its last call arrives. The host's clock moves
   *  with the fake timers. What fails this: a client that sends every call, or that does not wait out
   *  the interval — the bucket then refuses (the warning below) once its eight are spent. The pair, a
   *  writer that ignores the pace and is refused, is the bucket's boundary row
   *  (`host-ui-bridge.panels.test.ts`). */
  it("stays inside the host's acceptance bound however often setPanel is called", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    let clock = 0;
    let ctx!: SandboxContext;
    const { sent } = await start(
      (c) => {
        ctx = c;
      },
      ["sidebar"],
      () => clock,
    );
    vi.useFakeTimers();
    const advance = (ms: number) => {
      clock += ms;
      vi.advanceTimersByTime(ms);
    };
    for (let i = 0; i < 100; i += 1) {
      ctx.ui.setPanel("live", { html: `<p>${i}</p>` });
      await flush();
      advance(50);
      await flush();
    }
    advance(PANEL_UPDATE_INTERVAL_MS);
    await flush();
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining(panelRateMessage("live")),
    );
    const live = sent.filter((s) => s.id === "live");
    expect(panelContent("sb:live")?.seq).toBe(live.length);
    expect(panelContent("sb:live")?.content.html).toBe("<p>99</p>");
  });

  /** §4 · D4 — the host gates on `sidebar`. `setPanel` is void, so the refusal reaches the sandbox's
   *  log and not the plugin. */
  it("is refused by the host without sidebar — logged, not thrown", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    let ctx!: SandboxContext;
    await start(
      (c) => {
        ctx = c;
      },
      ["statusbar"],
    );
    expect(() => ctx.ui.setPanel("live", { html: "<p>x</p>" })).not.toThrow();
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringMatching(/ui_set_panel refused: .*"sidebar"/),
      ),
    );
    expect(panelContent("sb:live")).toBeNull();
  });
});

describe("ctx.ui.onPanelAction (D11 ③ · D13 · P12 · P13)", () => {
  /** The second entrance across the boundary, for a panel: that panel's handlers only, with the name,
   *  under rights until every one has settled. What fails this: `Promise.all` in the sandbox (the
   *  answer goes on the first rejection and the rights end while the slow handler runs), or every
   *  panel's handlers called. */
  it("runs that panel's handlers with the name, under rights until all settle", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    let slowStarted = false;
    await start((ctx) => {
      ctx.ui.onPanelAction("live", (action) => {
        calls.push(`live:${action}`);
        throw new Error("fast");
      });
      ctx.ui.onPanelAction("live", async () => {
        slowStarted = true;
        await slow;
      });
      ctx.ui.onPanelAction(
        "other",
        (action) => void calls.push(`other:${action}`),
      );
    });
    const running = dispatchPanelAction("sb", "sb:live", "go");
    await vi.waitFor(() => expect(slowStarted).toBe(true));
    // Room for a premature answer to cross the pair and settle the dispatch.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(promptRefusal("sb")).toBeNull();
    release();
    await running;
    expect(calls).toEqual(["live:go"]);
    expect(promptRefusal("sb")).toMatch(/commands is running/);
  });

  /** P12 — no handler is success; a panel the plugin did not declare is refused by the sandbox with
   *  the fixed sentence. The pair of the two answers. */
  it("answers ok with no handler, and refuses an undeclared panel", async () => {
    const { session } = await start(() => {});
    await expect(
      session.invokeAction({ kind: "panel", panelId: "live" }, "go"),
    ).resolves.toBeUndefined();
    await expect(
      session.invokeAction({ kind: "panel", panelId: "nope" }, "go"),
    ).rejects.toThrow('panel "nope" is not declared in contributions.panels');
  });

  /** D13 — the action ends at `CALL_TIMEOUT_MS`, and the rights with it. */
  it("ends the rights when the sandbox never answers", async () => {
    let started = false;
    await start((ctx) => {
      ctx.ui.onPanelAction("live", () => {
        started = true;
        return new Promise<void>(() => {});
      });
    });
    vi.useFakeTimers();
    const running = dispatchPanelAction("sb", "sb:live", "go");
    await vi.waitFor(() => expect(started).toBe(true));
    expect(promptRefusal("sb")).toBeNull();
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS);
    await running;
    expect(promptRefusal("sb")).toMatch(/commands is running/);
  });
});

describe("after the release, and after dispose (P14 · P23)", () => {
  /** The rollback releases a plugin's panels before it stops the session: a request the live session
   *  still carries meets a closed panel and writes nothing. */
  it("lets no request write a released panel back", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    let ctx!: SandboxContext;
    await start((c) => {
      ctx = c;
    });
    releasePanels("sb");
    ctx.ui.setPanel("live", { html: "<p>late</p>" });
    await vi.waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(closedPanelMessage("live")),
      ),
    );
    expect(panelContent("sb:live")).toBeNull();
  });

  /** A disposed session hands no request on, even for a panel that is open. The transport keeps its
   *  handlers through `close()` (`start`), so what stops the frame is the session's own: `dispose`'s
   *  `offMessage()` and `onHostRequest`'s `disposed` check. What fails this: a session that still
   *  routes a frame after `dispose` — measured with both of those gone (the handler records it and the
   *  store keeps it); either alone keeps this green, each covering the other. With the pair's own
   *  `close()` the row stayed green even with both gone. */
  it("drops a request that reaches a disposed session", async () => {
    const { sandbox, sent, session } = await start(() => {});
    session.dispose();
    sandbox.send({
      request: { html: "<p>late</p>", id: "live", kind: "ui_set_panel" },
      requestId: "late",
      type: "hostRequest",
    });
    await flush();
    expect(sent).toEqual([]);
    expect(panelContent("sb:live")).toBeNull();
  });
});
