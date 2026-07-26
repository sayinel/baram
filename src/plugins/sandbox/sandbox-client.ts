// §260 Sandbox-side client — runs INSIDE the isolated plugin WebviewWindow. The
// only outward channel is the transport. Guards re-activation and serializes
// outbound payloads defensively (real Tauri events are serde-JSON, not
// structured clone — functions/BigInt/etc. would corrupt silently).
import type {
  AIAPI,
  AIModel,
  NetworkAPI,
  PluginFileEvent,
  SandboxFilesAPI,
  SandboxUIAPI,
  StorageAPI,
} from "../types";
import type { PluginOp } from "./plugin-op";
import type {
  HostToSandbox,
  SandboxHostRequest,
  SandboxToHost,
} from "./protocol";
import type { SandboxTransport } from "./transport";

import { logger } from "../../utils/logger";

/**
 * §260 3c-2c — sandbox-side bound on a host-mediated request. Longer than the
 * host's own bound (`HOST_REQUEST_TIMEOUT_MS`), so in the normal case the HOST's
 * timeout fires first and the plugin gets a real error; this one only covers a lost
 * or never-delivered frame, whose pending entry would otherwise leak forever.
 * Restarted by each streamed token for the same reason the host's is (code review
 * MEDIUM-4): a token proves the request is alive.
 */
export const HOST_REQUEST_CLIENT_TIMEOUT_MS = 150_000;

export interface SandboxContext {
  /**
   * §260 3c-2c — host-mediated, NOT brokered in Rust: the model, provider and
   * privacy-mode decisions live in the main realm, and the request carries none of
   * them (see `SandboxHostRequest`). The `ai` capability is checked host-side, which
   * is enforcing because a `plugin-*` window holds no `llm_*` ACL grant.
   */
  ai: AIAPI;
  commands: {
    register(id: string, handler: (...args: unknown[]) => unknown): void;
  };
  events: {
    emit(event: string, ...args: unknown[]): void;
    /**
     * §260 Phase 4a — overloaded so the file events' payload actually reaches plugin
     * code as `PluginFileEvent` (code review nit): with only the `unknown[]` signature an
     * author had to cast to learn the shape of the very thing this phase added.
     */
    on(
      event: "file:open" | "file:save",
      handler: (file: PluginFileEvent) => void,
    ): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
  };
  // §260 3c-1 — brokered privileged APIs. Routed through `broker` (= plugin_call
  // in production). Exposed unconditionally: the Rust authorizer, keyed on the
  // Tauri-verified window.label(), is the real per-call capability gate — an
  // op for an unregistered capability fails closed there, not here.
  files: SandboxFilesAPI;
  network: NetworkAPI;
  storage: StorageAPI;
  /**
   * §260 Phase 4a — data-only UI: the host renders on this plugin's behalf, so there is
   * no DOM or CSS here (that is the trusted tier's `UIAPI`). Host-mediated like `ai`,
   * and gated there — attribution, sanitising and rate limiting cannot be enforced in
   * this realm.
   */
  ui: SandboxUIAPI;
}

interface PluginModule {
  activate?: (ctx: SandboxContext) => Promise<unknown> | unknown;
}

export function startSandboxClient(
  transport: SandboxTransport<HostToSandbox, SandboxToHost>,
  // §260 3c-2b — takes the plugin's SOURCE, not a URL: production wraps it in a
  // blob URL (see sandbox-entry.ts), tests pass a module directly. Injectable so no
  // test needs `URL.createObjectURL`.
  importer: (source: string) => Promise<PluginModule>,
  broker: (op: PluginOp) => Promise<unknown>,
): void {
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const eventHandlers = new Map<string, Array<(...args: unknown[]) => void>>();
  let activateState: "activating" | "done" | "idle" = "idle";

  // §260 3c-2c — host-mediated requests awaiting an answer, by our own correlation
  // id. Bounded by a timer so a frame the host never answers cannot leak an entry
  // (and the plugin's promise) for the life of the sandbox.
  const hostPending = new Map<
    string,
    {
      onToken?: (token: string) => void;
      reject: (e: Error) => void;
      resolve: (v: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
      /** Restart the stall timer — called on each streamed token. */
      touch: () => void;
    }
  >();
  let hostSeq = 0;

  function hostRequest(
    request: SandboxHostRequest,
    onToken?: (token: string) => void,
  ): Promise<unknown> {
    const requestId = `host-${++hostSeq}`;
    return new Promise<unknown>((resolve, reject) => {
      const startTimer = () =>
        setTimeout(() => {
          hostPending.delete(requestId);
          reject(
            new Error(
              `Host request "${request.kind}" produced nothing for ${HOST_REQUEST_CLIENT_TIMEOUT_MS}ms`,
            ),
          );
        }, HOST_REQUEST_CLIENT_TIMEOUT_MS);
      hostPending.set(requestId, {
        onToken,
        reject,
        resolve,
        timer: startTimer(),
        touch: () => {
          const p = hostPending.get(requestId);
          if (!p) return;
          clearTimeout(p.timer);
          p.timer = startTimer();
        },
      });
      transport.send({ type: "hostRequest", requestId, request });
    });
  }

  const ai: AIAPI = {
    complete: (prompt, opts) =>
      hostRequest({ kind: "ai_complete", opts, prompt }) as Promise<string>,
    listModels: () =>
      hostRequest({ kind: "ai_list_models" }) as Promise<AIModel[]>,
    stream: async (prompt, opts, onToken) => {
      await hostRequest({ kind: "ai_stream", opts, prompt }, onToken);
    },
  };

  const storage: StorageAPI = {
    list: () => broker({ kind: "storage_list" }) as Promise<string[]>,
    read: (key) =>
      broker({ key, kind: "storage_read" }) as Promise<null | string>,
    remove: (key) => broker({ key, kind: "storage_remove" }) as Promise<void>,
    write: (key, value) =>
      broker({ key, kind: "storage_write", value }) as Promise<void>,
  };
  const network: NetworkAPI = {
    fetch: (url, init) =>
      broker({ init, kind: "http_fetch", url }) as ReturnType<
        NetworkAPI["fetch"]
      >,
  };
  // §260 3c-2c — the same three operations as the trusted tier's FilesAPI. Nothing is
  // interpreted here: a broker rejection (denied capability, path outside the vault,
  // `.baram`, over the cap) propagates to the plugin, because a sandbox that softened a
  // deny into `undefined` would let the plugin proceed as though the write had landed.
  //
  // §260 Phase 4a — `path` is CONTEXT-RELATIVE and `opts.context` names the anchor. This
  // realm is told no root, so it cannot form an absolute path, and Rust refuses one if it
  // tries; passing the `context` from a delivered event is what keeps a call aimed at the
  // vault the event came from when the user has since switched.
  const files: SandboxFilesAPI = {
    listDir: (path, opts) =>
      broker({
        context: opts?.context,
        kind: "files_list",
        path,
      }) as Promise<string[]>,
    readFile: (path, opts) =>
      broker({
        context: opts?.context,
        kind: "files_read",
        path,
      }) as Promise<string>,
    writeFile: (path, content, opts) =>
      broker({
        content,
        context: opts?.context,
        kind: "files_write",
        path,
      }) as Promise<void>,
  };
  // §260 Phase 4a — void-returning like the trusted tier's `UIAPI`, so a plugin is not
  // forced to await a toast. The underlying request still has an answer: log a refusal
  // (denied capability, undeclared item, throttled) rather than leaving an unhandled
  // rejection, which in this realm would be invisible.
  const fireUI = (request: SandboxHostRequest): void => {
    void hostRequest(request).catch((err: unknown) => {
      logger.warn(
        `[Sandbox] ${request.kind} refused: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  };
  const ui: SandboxUIAPI = {
    setStatusBarText: (id, text) => fireUI({ id, kind: "ui_status_bar", text }),
    showNotification: (message, type) =>
      fireUI({ kind: "ui_notify", message, type }),
  };

  const ctx: SandboxContext = {
    ai,
    commands: { register: (id, handler) => void commands.set(id, handler) },
    events: {
      emit(event, ...args) {
        try {
          assertSerializable(args);
          transport.send({ type: "emitEvent", event, args });
        } catch {
          logger.warn(
            `[Sandbox] dropped unserializable emit for event "${event}"`,
          );
        }
      },
      on(event: string, handler: (...args: never[]) => void) {
        const list = eventHandlers.get(event) ?? [];
        // The overloads on `SandboxContext.events.on` are what give plugin authors a
        // typed `PluginFileEvent`; the registry itself holds the erased form, because
        // one list carries handlers for every event name.
        list.push(handler as (...args: unknown[]) => void);
        eventHandlers.set(event, list);
      },
    },
    files,
    network,
    storage,
    ui,
  };

  async function onActivate(): Promise<void> {
    if (activateState !== "idle") return; // M4: ignore repeated activate
    activateState = "activating";
    commands.clear(); // each attempt starts clean — no stale regs from a failed retry
    eventHandlers.clear();
    // …including host requests the previous attempt left outstanding (3c-2c code
    // review, LOW-4). Their promises belong to plugin code that is about to be
    // replaced, and each still holds a stall timer; rejecting them is both the honest
    // answer and what keeps a retry loop from accumulating timers.
    for (const [requestId, p] of hostPending) {
      clearTimeout(p.timer);
      hostPending.delete(requestId);
      p.reject(new Error("Sandbox re-activated before this request completed"));
    }
    try {
      // Our own bundle, resolved in Rust from this window's label.
      //
      // ‼️ INVARIANT (§260 3c-2b review, M1): the result must stay a SCALAR JSON
      // string. An invoke result is not automatically safe from tauri's shared
      // channel-data queue — `ipc/protocol.rs` sends results through a `Channel`, and
      // `ipc/channel.rs` routes any payload ≥8 KiB whose JSON starts with `{` or `[`
      // through the app-global `ChannelDataIpcQueue`, fetched via the ACL-exempt
      // `FETCH_CHANNEL_DATA_COMMAND` with a guessable sequential id (3c-2a review
      // I3). Today this is safe on two counts: desktop uses the custom-protocol IPC
      // path (result returns as an HTTP body), and even on the postMessage fallback a
      // bare JSON string never matches the `{`/`[` condition. Wrap this in an object
      // (e.g. `{source, hash}`) and a 4 MiB bundle becomes stealable by another
      // sandbox on non-macOS — so if that shape must change, chunk it or keep it out
      // of the channel path deliberately.
      //
      // ‼️ The invariant holds for THIS op, not for the broker generally (§260 3c-2c
      // code review, MEDIUM-2): `files_list`/`storage_list` return arrays and
      // `http_fetch` an object, so they DO match the condition once they cross 8 KiB —
      // `files_list` first, on a directory of a few hundred notes. Rust warns in dev
      // when a result crosses it (`warn_if_result_enters_the_shared_queue`); chunking
      // is owed with Phase 4's document transforms.
      const source = await broker({ kind: "source_read" });
      if (typeof source !== "string") {
        throw new Error("broker returned a non-string plugin source");
      }
      const mod = await importer(source);
      if (typeof mod.activate === "function") await mod.activate(ctx);
      activateState = "done";
      transport.send({
        type: "ready",
        registered: {
          commands: [...commands.keys()],
          events: [...eventHandlers.keys()],
        },
      });
    } catch (err) {
      activateState = "idle";
      transport.send({
        type: "activateError",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onInvoke(
    callId: string,
    commandId: string,
    args: unknown[],
  ): Promise<void> {
    const handler = commands.get(commandId);
    if (!handler) {
      transport.send({
        type: "callResult",
        callId,
        ok: false,
        error: `No command "${commandId}"`,
      });
      return;
    }
    try {
      const value = await handler(...args);
      assertSerializable(value);
      transport.send({ type: "callResult", callId, ok: true, value });
    } catch (err) {
      transport.send({
        type: "callResult",
        callId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  transport.onMessage((m) => {
    switch (m.type) {
      case "activate":
        void onActivate();
        break;
      case "deactivate":
        transport.close();
        break;
      case "deliverEvent":
        (eventHandlers.get(m.event) ?? []).forEach((h) => h(...m.args));
        break;
      case "hostResponse": {
        // An unknown id is ignored, not thrown on: it means our own timeout already
        // rejected (or a host bug), and the plugin's promise is settled either way.
        const p = hostPending.get(m.requestId);
        if (!p) break;
        clearTimeout(p.timer);
        hostPending.delete(m.requestId);
        if (m.ok) p.resolve(m.value);
        else p.reject(new Error(m.error));
        break;
      }
      case "hostStreamToken": {
        const p = hostPending.get(m.requestId);
        if (!p) break;
        p.touch(); // a token proves the request is alive (code review MEDIUM-4)
        p.onToken?.(m.token);
        break;
      }
      case "invokeCommand":
        void onInvoke(m.callId, m.commandId, m.args);
        break;
    }
  });
}

function assertSerializable(value: unknown): void {
  // Throws on functions/BigInt/cycles that JSON (the wire format for Tauri
  // events) cannot faithfully carry.
  JSON.stringify(value, (_k, v) => {
    if (typeof v === "function" || typeof v === "bigint")
      throw new Error("value is not serializable");
    return v;
  });
}
