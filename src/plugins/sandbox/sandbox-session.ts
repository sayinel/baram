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

/**
 * §260 3c-3 — the live smoke hit "Sandbox activate timed out" on the FIRST load of a
 * cold `tauri dev`, then worked on reload. In dev the first activate also pays for
 * Vite compiling `sandbox.html` + the sandbox entry on demand, while the app's own
 * startup competes for the same main thread — none of which says anything about the
 * plugin. A packaged build loads that entry from disk, so the tight budget (which
 * exists to catch a wedged sandbox) stays where it can mean something.
 */
const ACTIVATE_TIMEOUT_MS = import.meta.env.DEV ? 15_000 : 5_000;
const ACTIVATE_RETRY_MS = 250;
const CALL_TIMEOUT_MS = 30_000;

export type HostService = ServiceOf<SandboxHostRequest["kind"]>;
/** The service a mediated request belongs to, from its `kind` prefix. */
type ServiceOf<K> = K extends `${infer S}_${string}` ? S : never;

/**
 * §260 3c-2c / 4b — how many mediated requests of each SERVICE one plugin may have
 * outstanding.
 *
 * Originally one budget of 4 for everything, justified by `ai`: each request costs the
 * user tokens and holds a provider connection, so a plugin must not park an unbounded
 * number. But a slot is held until the handler SETTLES, and an `ai` stream may legitimately
 * run for `HOST_REQUEST_TIMEOUT_MS` — so four concurrent completions starved every other
 * service. The 4a review already noted the consequence for `ui` (a plugin could not show
 * the toast reporting its own AI failure); Phase 4b makes it worse, because a plugin doing
 * AI work then cannot read the document either.
 *
 * Split per service, because the reason for the bound is per service: `ai` is bounded by
 * what it COSTS, `editor` and `ui` by what they can do to the main thread — and neither of
 * those spends anything outside the app. A `Record` over the services derived from the
 * request union, so TypeScript refuses a new service without a budget.
 */
export const INFLIGHT_BUDGET: Record<HostService, number> = {
  ai: 4,
  editor: 4,
  // §260 Phase 4c — the `Record` did its job: adding `settings_read` would not compile
  // without a budget here. Same 4 as `editor` for the same reason (main-realm work, no
  // external cost), though a settings read is far cheaper: it resolves at most
  // `MAX_SETTING_FIELDS` values. The client serialises staged reads anyway, so this bound
  // is a backstop against a plugin driving the transport directly, not a queue depth.
  settings: 4,
  ui: 8,
};

/**
 * Which budget a request draws on. Unknown prefixes are refused rather than defaulted:
 * `budget[unknown]` is `undefined`, and `size >= undefined` is false — i.e. an unrecognised
 * kind would have been UNBOUNDED. Fail closed instead.
 */
function serviceOf(kind: string): HostService | null {
  const service = kind.slice(0, kind.indexOf("_"));
  return Object.hasOwn(INFLIGHT_BUDGET, service)
    ? (service as HostService)
    : null;
}

/**
 * Host-side bound on one mediated request — a STALL detector, not a wall-clock
 * ceiling: the timer is restarted by every streamed token (§260 3c-2c code review,
 * MEDIUM-4), so a completion that is visibly producing output is never cut off, while
 * a provider that goes quiet still releases its slot. Without any bound, a provider
 * that never answers would hold a slot forever and the plugin's `ai` would be dead
 * until reload.
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
    {
      answered: boolean;
      /** Which budget this entry occupies (§260 Phase 4b). */
      service: HostService;
      timer: null | ReturnType<typeof setTimeout>;
    }
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
    // Answer outstanding host requests BEFORE `deactivate` (§260 3c-2c code review,
    // MEDIUM-1). Answering matters because the awaiting promise lives in the SANDBOX,
    // so a dropped frame hangs the plugin's `await` instead of failing it — and the
    // client closes its transport the moment it sees `deactivate`
    // (`startSandboxClient`), which would drop exactly the frames this loop exists to
    // send. The original comment blamed `transport.close()` below for the ordering
    // constraint; the frame that actually stops delivery is `deactivate`.
    // (`answerHostRequest` skips ids already answered, e.g. timed out.)
    for (const requestId of [...this.inflightHost.keys()]) {
      this.answerHostRequest(requestId, {
        type: "hostResponse",
        requestId,
        ok: false,
        error: "Sandbox session disposed",
      });
    }
    this.transport.send({ type: "deactivate" });
    this.offMessage();
    this.activateSettle?.reject(new Error("Sandbox session disposed"));
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Sandbox session disposed"));
    }
    this.pending.clear();
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
  private answerHostRequest(
    requestId: string,
    // Narrowed (3c-2c code review, LOW-2): this path consumes an in-flight entry, so
    // it must only ever emit the frame that answers one — not, say, a `deactivate`.
    msg: Extract<HostToSandbox, { type: "hostResponse" }>,
  ): void {
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
    const service = serviceOf(request.kind);
    if (!service) {
      this.handleHostRequestRefusal(
        requestId,
        `unknown host service for request "${request.kind}"`,
      );
      return;
    }
    const budget = INFLIGHT_BUDGET[service];
    const inFlightForService = [...this.inflightHost.values()].filter(
      (e) => e.service === service,
    ).length;
    if (inFlightForService >= budget) {
      this.handleHostRequestRefusal(
        requestId,
        `too many "${service}" requests in flight (max ${budget}); ` +
          `a timed-out request still holds its slot until the handler settles`,
      );
      return;
    }
    const startTimer = () =>
      setTimeout(() => {
        this.answerHostRequest(requestId, {
          type: "hostResponse",
          requestId,
          ok: false,
          error: `Host request produced nothing for ${HOST_REQUEST_TIMEOUT_MS}ms`,
        });
      }, HOST_REQUEST_TIMEOUT_MS);
    const entry = { answered: false, service, timer: startTimer() };
    this.inflightHost.set(requestId, entry);

    const onToken = (token: string) => {
      // Compare the ENTRY, not just the id (3c-2c code review, MEDIUM-5): `requestId`
      // is sandbox-supplied, so a closure that trusts the id alone can deliver an old
      // stream's tokens under a newer request that reused it. Reference identity ties
      // each token to the request that actually started this handler.
      if (this.inflightHost.get(requestId) !== entry) return;
      // A token is proof of life, so the stall timer restarts (MEDIUM-4). Otherwise a
      // long completion that is streaming fine would be cut off at the bound.
      if (entry.answered) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = startTimer();
      this.transport.send({ type: "hostStreamToken", requestId, token });
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
