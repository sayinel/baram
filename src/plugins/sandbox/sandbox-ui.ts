// §260 Phase 4a · §394 spec 0073 D14 — `ctx.ui` inside the sandbox realm: the status bar and the toast
// (moved out of `sandbox-client.ts` by plan 0126 P2) and the plugin's sidebar panels. The host told
// `activate` which panel ids the manifest declares (`panelIds`, plan 0126 P11), whether or not consent
// granted `sidebar`: `setPanel` and `onPanelAction` refuse any other id at once, with the host's
// sentence (`panel-messages.ts`), and the host refuses it again (`host-ui-bridge.ts`). Without
// `sidebar` the host's gate refuses every `setPanel`, which `send` logs.
//
// `setPanel` keeps one `ui_set_panel` per panel on its way, each started at least
// `PANEL_UPDATE_INTERVAL_MS` after the one before, and a call made meanwhile replaces the content
// waiting to go — the last one wins. The reason is the host's bounds: it refuses a `ui` request past
// `INFLIGHT_BUDGET` and a panel's request past its acceptance bucket (`host-ui-bridge.ts`, plan 0126
// P34), and a refused request that held the newest content would leave the panel stale. This pace is
// a courtesy, not a bound — this realm is the plugin's; the host enforces both what it takes (the
// bucket) and what it draws (`panel-painter.ts`). It stays inside the bucket, on two premises: a send
// starts only after the previous one's answer — or after this realm gives up waiting for it
// (`HOST_REQUEST_CLIENT_TIMEOUT_MS`: only a request still unanswered by then, a lost or stalled frame,
// can be overtaken by the next send) — and the host's clock does not run backwards (the bucket clamps
// a backward step, `takeToken`). On those, a send also starts an interval after the previous one
// started, so the host takes the j-th no later than the (j+1)-th starts, and any m of them span at
// least (m − 2) intervals — at most two more than the bucket earns, against a burst of
// `PANEL_UPDATE_BURST`. A re-activation (`reset`) can start one send while the previous activation's
// is still on its way.

import type { Disposable, RenderedContent, SandboxUIAPI } from "../types";
import type { SandboxHostRequest } from "./protocol";

import { logger } from "../../utils/logger";
import {
  PANEL_UPDATE_INTERVAL_MS,
  readRenderedContent,
} from "../rendered/limits";
import { undeclaredPanelMessage } from "../rendered/panel-messages";

/** What `sandbox-client.ts` gets: the plugin's `ctx.ui`, and the two calls the client makes itself. */
export interface SandboxUI {
  api: SandboxUIAPI;
  /** A fresh activate: the host's panel ids, and no handler or waiting content. */
  reset(panelIds: string[] | undefined): void;
  /**
   * The host's `invokeAction` for panel `id` (plan 0126 P12): every handler of that panel, settled, then
   * the first failure thrown — or the undeclared-id refusal. No handler is success.
   */
  runPanelAction(id: string, action: string): Promise<void>;
}

type PanelHandler = (action: string) => Promise<void> | void;

/** One panel's sending: the content waiting to go, and whether a send is on its way. */
interface PanelQueue {
  next: null | RenderedContent;
  sending: boolean;
}

export function createSandboxUI(
  hostRequest: (request: SandboxHostRequest) => Promise<unknown>,
): SandboxUI {
  let declared: ReadonlySet<string> = new Set();
  let handlers = new Map<string, Set<PanelHandler>>();
  let queues = new Map<string, PanelQueue>();

  /**
   * §260 Phase 4a — every `ui` request is void-returning, as the trusted tier's `UIAPI` is, so a plugin
   * is not forced to await a toast. The request still has an answer: a refusal (denied capability,
   * undeclared item, throttled) is logged rather than left an unhandled rejection, which in this realm
   * would be invisible. Resolves when the host has answered.
   */
  const send = (request: SandboxHostRequest): Promise<void> =>
    hostRequest(request).then(
      () => undefined,
      (err: unknown) => {
        logger.warn(
          `[Sandbox] ${request.kind} refused: ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );

  const requireDeclared = (
    method: "onPanelAction" | "setPanel",
    id: string,
  ) => {
    if (!declared.has(id)) throw new Error(undeclaredPanelMessage(method, id));
  };

  /** Send what waits in `queue` until nothing does — each send at least an interval after the last. */
  const drain = async (id: string, queue: PanelQueue): Promise<void> => {
    queue.sending = true;
    try {
      while (queue.next !== null) {
        const content = queue.next;
        queue.next = null;
        const interval = new Promise<void>((resolve) => {
          setTimeout(resolve, PANEL_UPDATE_INTERVAL_MS);
        });
        await send({ ...content, id, kind: "ui_set_panel" });
        await interval;
      }
    } finally {
      queue.sending = false;
    }
  };

  const api: SandboxUIAPI = {
    onPanelAction(id, handler): Disposable {
      requireDeclared("onPanelAction", id);
      const list = handlers.get(id) ?? new Set<PanelHandler>();
      handlers.set(id, list);
      list.add(handler);
      return { dispose: () => void list.delete(handler) };
    },
    setPanel(id, content) {
      requireDeclared("setPanel", id);
      // Read as the host's `prepareDrawable` reads a result (`readRenderedContent`): each field once,
      // so the value checked is the value sent; a non-object meets the same fixed sentence.
      const checked = readRenderedContent(content);
      if (typeof checked === "string") throw new Error(checked);
      const queue = queues.get(id) ?? { next: null, sending: false };
      queues.set(id, queue);
      queue.next = checked;
      if (!queue.sending) void drain(id, queue);
    },
    setStatusBarText: (id, text) =>
      void send({ id, kind: "ui_status_bar", text }),
    showNotification: (message, type) =>
      void send({ kind: "ui_notify", message, type }),
  };

  return {
    api,
    reset(panelIds) {
      declared = new Set(panelIds ?? []);
      handlers = new Map();
      // A send on its way finishes; nothing waiting from the previous activation goes after it.
      for (const queue of queues.values()) queue.next = null;
      queues = new Map();
    },
    async runPanelAction(id, action) {
      if (!declared.has(id)) {
        throw new Error(undeclaredPanelMessage("onPanelAction", id));
      }
      // D11 ③ — as a code block's `onAction`: every handler settles before the answer goes, so one
      // rejecting does not end the rights while another still runs.
      const settled = await Promise.allSettled(
        [...(handlers.get(id) ?? [])].map((handler) =>
          Promise.resolve().then(() => handler(action)),
        ),
      );
      const failed = settled.find((result) => result.status === "rejected");
      if (failed !== undefined) throw failed.reason;
    },
  };
}
