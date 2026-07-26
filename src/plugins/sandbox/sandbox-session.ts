// §260 Host-side sandbox session for ONE plugin. Manifest-authoritative:
// `activate` resolves with the DECLARED contributions; the sandbox's `ready`
// report is validated against it (warn on drift). Resends `activate` to survive
// the sandbox's async-listen race; per-call timeouts prevent hung invocations.
import type { PluginContributions } from "../types";
import type {
  HostToSandbox,
  SandboxHostRequest,
  SandboxRegisteredReport,
  SandboxToHost,
} from "./protocol";
import type { SandboxTransport } from "./transport";

import { logger } from "../../utils/logger";

const ACTIVATE_TIMEOUT_MS = 5000;
const ACTIVATE_RETRY_MS = 250;
const CALL_TIMEOUT_MS = 30_000;

/**
 * §260 3c-2c — how many host-mediated requests one plugin may have outstanding.
 * Each `ai` request costs the user tokens (money) and holds a provider connection,
 * so a plugin must not be able to park an unbounded number. Low on purpose: a
 * plugin doing real work awaits its completion before asking for the next.
 */
export const MAX_INFLIGHT_HOST_REQUESTS = 4;

/**
 * Host-side bound on one mediated request. Generous because a long completion is
 * legitimately slow, but finite: without it a provider that never answers would
 * hold an in-flight slot forever and the plugin's `ai` would be dead until reload.
 */
export const HOST_REQUEST_TIMEOUT_MS = 120_000;

/**
 * §260 3c-2c — services the host performs on a sandbox's behalf. Returns the value
 * to send back; tokens go through `onToken` as they arrive. The handler owns the
 * capability check and the policy — the session only routes (see
 * `host-ai-bridge.ts`).
 */
export type HostRequestHandler = (
  request: SandboxHostRequest,
  onToken: (token: string) => void,
) => Promise<unknown>;

interface Pending {
  reject: (e: Error) => void;
  resolve: (v: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SandboxSession {
  contributions: null | PluginContributions = null;
  registered: null | SandboxRegisteredReport = null;

  private activateSettle: null | {
    reject: (e: Error) => void;
    resolve: (c: PluginContributions) => void;
  } = null;
  private callSeq = 0;
  private declared: null | PluginContributions = null;
  private disposed = false;
  private readonly emitHandlers = new Set<
    (event: string, args: unknown[]) => void
  >();
  /**
   * §260 3c-2c — mediated requests this session is carrying, by the sandbox's
   * correlation id.
   *
   * Two distinct states, because they end at different times (3c-2c security review,
   * F4/F5):
   * - `answered` — a `hostResponse` has been sent. At most one per id, ever.
   * - membership — the request is still OCCUPYING a slot, which lasts until the
   *   handler actually settles, NOT until it is answered.
   *
   * Freeing the slot at answer time was the defect: on timeout the provider stream
   * keeps running (nothing cancels it), so a plugin could fire 4, wait out the
   * timeout, fire 4 more, and hold unbounded concurrent LLM streams — defeating the
   * bound whose stated purpose is to limit what one plugin can spend. Keeping the
   * entry until settle also means a timed-out id cannot be replayed while its old
   * handler is alive, which is what kept old tokens from streaming into a new
   * request's callback.
   */
  private readonly inflightHost = new Map<
    string,
    { answered: boolean; timer: null | ReturnType<typeof setTimeout> }
  >();
  private readonly offMessage: () => void;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly transport: SandboxTransport<SandboxToHost, HostToSandbox>,
    /** Absent when this plugin gets no host-mediated services (see `ai`). */
    private readonly hostRequestHandler?: HostRequestHandler,
  ) {
    this.offMessage = transport.onMessage((m) => this.handle(m));
  }

  activate(
    pluginId: string,
    declared: PluginContributions,
  ): Promise<PluginContributions> {
    this.declared = declared;
    return new Promise<PluginContributions>((resolve, reject) => {
      const send = () => this.transport.send({ type: "activate", pluginId });
      const retry = setInterval(send, ACTIVATE_RETRY_MS);
      const timeout = setTimeout(() => {
        finish();
        reject(new Error(`Sandbox activate timed out for ${pluginId}`));
      }, ACTIVATE_TIMEOUT_MS);
      const finish = () => {
        clearInterval(retry);
        clearTimeout(timeout);
        this.activateSettle = null;
      };
      this.activateSettle = {
        reject: (e) => {
          finish();
          reject(e);
        },
        resolve: (c) => {
          finish();
          resolve(c);
        },
      };
      send();
    });
  }

  deliverEvent(event: string, args: unknown[]): void {
    if (!this.disposed)
      this.transport.send({ type: "deliverEvent", event, args });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.transport.send({ type: "deactivate" });
    this.offMessage();
    this.activateSettle?.reject(new Error("Sandbox session disposed"));
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Sandbox session disposed"));
    }
    this.pending.clear();
    // Answer, don't just forget: the awaiting promise lives in the SANDBOX, so a
    // dropped frame would hang the plugin's `await` instead of failing it. Sent
    // before `transport.close()` below, which is why dispose's order matters.
    // (`answerHostRequest` skips ids already answered, e.g. timed out.)
    for (const requestId of [...this.inflightHost.keys()]) {
      this.answerHostRequest(requestId, {
        type: "hostResponse",
        requestId,
        ok: false,
        error: "Sandbox session disposed",
      });
    }
    // Timers were cleared as each id was answered; anything still answered-but-held
    // only occupied a slot, and the slot dies with the session.
    for (const entry of this.inflightHost.values()) {
      if (entry.timer) clearTimeout(entry.timer);
    }
    this.inflightHost.clear();
    this.emitHandlers.clear();
    this.transport.close();
  }

  invokeCommand(commandId: string, args: unknown[] = []): Promise<unknown> {
    if (this.disposed)
      return Promise.reject(new Error("Sandbox session disposed"));
    const callId = `call-${++this.callSeq}`;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(new Error(`Sandbox command "${commandId}" timed out`));
      }, CALL_TIMEOUT_MS);
      this.pending.set(callId, { reject, resolve, timer });
      this.transport.send({ type: "invokeCommand", callId, commandId, args });
    });
  }

  onEmit(handler: (event: string, args: unknown[]) => void): () => void {
    this.emitHandlers.add(handler);
    return () => this.emitHandlers.delete(handler);
  }

  /**
   * Send the one response an id gets. Idempotent: whichever of {handler settles,
   * timeout, dispose} arrives second sees `answered` and drops out, so no id is ever
   * answered twice. Does NOT free the slot — see `inflightHost` and
   * `releaseHostRequest`.
   */
  private answerHostRequest(requestId: string, msg: HostToSandbox): void {
    const entry = this.inflightHost.get(requestId);
    if (!entry || entry.answered) return;
    entry.answered = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    this.transport.send(msg);
  }

  private handle(m: SandboxToHost): void {
    switch (m.type) {
      case "activateError":
        this.activateSettle?.reject(new Error(m.error));
        break;
      case "callResult": {
        const p = this.pending.get(m.callId);
        if (!p) break;
        clearTimeout(p.timer);
        this.pending.delete(m.callId);
        if (m.ok) p.resolve(m.value);
        else p.reject(new Error(m.error));
        break;
      }
      case "emitEvent":
        this.emitHandlers.forEach((h) => h(m.event, m.args));
        break;
      case "hostRequest":
        this.onHostRequest(m.requestId, m.request);
        break;
      case "ready":
        if (!this.activateSettle || !this.declared) break; // late/duplicate ready
        this.registered = m.registered;
        this.validate(m.registered, this.declared);
        this.contributions = this.declared;
        this.activateSettle.resolve(this.declared);
        break;
    }
  }

  private handleHostRequestRefusal(requestId: string, error: string): void {
    // Not routed through `answerHostRequest`: a refusal has no in-flight entry (that
    // is precisely why it is refused), so it answers directly.
    this.transport.send({ type: "hostResponse", requestId, ok: false, error });
  }

  private onHostRequest(requestId: string, request: SandboxHostRequest): void {
    if (this.disposed) return;
    if (!this.hostRequestHandler) {
      // Say so rather than dropping the frame: the plugin is awaiting a promise.
      this.handleHostRequestRefusal(
        requestId,
        "host-mediated services are not available to this plugin",
      );
      return;
    }
    if (this.inflightHost.has(requestId)) {
      this.handleHostRequestRefusal(
        requestId,
        `host request "${requestId}" is already in flight`,
      );
      return;
    }
    if (this.inflightHost.size >= MAX_INFLIGHT_HOST_REQUESTS) {
      this.handleHostRequestRefusal(
        requestId,
        `too many host requests in flight (max ${MAX_INFLIGHT_HOST_REQUESTS}); ` +
          `a timed-out request still holds its slot until the provider finishes`,
      );
      return;
    }
    const timer = setTimeout(() => {
      this.answerHostRequest(requestId, {
        type: "hostResponse",
        requestId,
        ok: false,
        error: `Host request timed out after ${HOST_REQUEST_TIMEOUT_MS}ms`,
      });
    }, HOST_REQUEST_TIMEOUT_MS);
    this.inflightHost.set(requestId, { answered: false, timer });

    // Tokens stop once the request is answered (timed out or disposed): the sandbox
    // has already rejected, so a later token would arrive for an id whose promise is
    // settled — and after `dispose` the transport is closed anyway.
    const onToken = (token: string) => {
      if (this.inflightHost.get(requestId)?.answered === false) {
        this.transport.send({ type: "hostStreamToken", requestId, token });
      }
    };
    this.hostRequestHandler(request, onToken)
      .then(
        (value) =>
          this.answerHostRequest(requestId, {
            type: "hostResponse",
            requestId,
            ok: true,
            value,
          }),
        (err: unknown) =>
          this.answerHostRequest(requestId, {
            type: "hostResponse",
            requestId,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
      )
      // Settling — not answering — is what frees the slot, so the bound tracks live
      // provider work. `finally` so a handler that throws still releases.
      .finally(() => this.releaseHostRequest(requestId));
  }

  /** Give up the slot: the handler is done, however it ended. */
  private releaseHostRequest(requestId: string): void {
    const entry = this.inflightHost.get(requestId);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.inflightHost.delete(requestId);
  }

  private validate(
    report: SandboxRegisteredReport,
    declared: PluginContributions,
  ): void {
    const declaredIds = new Set((declared.commands ?? []).map((c) => c.id));
    for (const id of report.commands) {
      if (!declaredIds.has(id))
        logger.warn(`[Sandbox] plugin bound undeclared command "${id}"`);
    }
    for (const id of declaredIds) {
      if (!report.commands.includes(id))
        logger.warn(`[Sandbox] declared command "${id}" was not registered`);
    }
  }
}
